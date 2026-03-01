/**
 * Payment Route Tests — Snap Token Generation Logic
 *
 * Strategy: all external dependencies (Drizzle DB, Supabase auth, Midtrans API)
 * are mocked so tests run fully offline with no real network or DB calls.
 *
 * Auth note: authMiddleware calls supabase.auth.getUser(token).
 *   - Valid token  → resolves to a real User object → c.set('user', user)
 *   - Invalid/missing token → middleware short-circuits with 401
 *
 * Callback note: POST /callback has NO Supabase auth middleware — Midtrans calls
 * it server-to-server. However, every legitimate Midtrans notification includes a
 * signature_key that is verified via SHA512(order_id + status_code + gross_amount
 * + SERVER_KEY). Requests without a valid signature are rejected with 401.
 * When a valid-signature request references a non-existent order_id, the DB update
 * matches 0 rows → the handler still returns { success: true } (intentional ACK).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../index.js';

let mockPaymentRow: Record<string, unknown> | null = null;

const mockTeamRow = {
  id: 'user-uuid-aaaa-bbbb',
  competitionId: 'comp-uuid-1111-2222',
  leadName: 'Budi Santoso',
  status: 'Registered',
};

const mockCompetitionRow = {
  id: 'comp-uuid-1111-2222',
  name: 'Wildcat',
};

const mockUser = {
  id: 'user-uuid-aaaa-bbbb',
  email: 'budi@test.com',
};

let authShouldSucceed = true;
let mockSignatureValid = true;

let mockUpdatedRows: Record<string, unknown>[] = [];
let mockSetCalls: Record<string, unknown>[] = [];

vi.mock('../lib/supabase.js', () => ({
  createSupabaseClient: () => ({
    auth: {
      getUser: vi.fn(async () => {
        if (!authShouldSucceed) {
          return { data: { user: null }, error: new Error('Invalid token') };
        }
        return { data: { user: mockUser }, error: null };
      }),
    },
  }),
}));

vi.mock('../db/index.js', () => ({
  createDb: () => {
    const makeSelectChain = () => {
      let _table: string | null = null;

      const chain = {
        from: (table: { _?: { name?: string }; [k: string | symbol]: unknown }) => {
          const drizzleName = table[Symbol.for('drizzle:Name')];
          const name = typeof drizzleName === 'string' ? drizzleName : (table._?.name ?? '');
          if (name === 'transactions') _table = 'transactions';
          else if (name === 'competitions') _table = 'competitions';
          else _table = 'team_accounts';
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: async () => {
          if (_table === 'transactions') return mockPaymentRow ? [mockPaymentRow] : [];
          if (_table === 'competitions') return [mockCompetitionRow];
          return [mockTeamRow];
        },
      };
      return chain;
    };

    const makeUpdateChain = () => {
      const chain = {
        set: (data: Record<string, unknown>) => {
          mockSetCalls.push(data);
          return chain;
        },
        where: () => chain,
        returning: async () => mockUpdatedRows,
      };
      return chain;
    };

    return {
      select: makeSelectChain,
      insert: () => ({ values: async () => undefined }),
      update: () => makeUpdateChain(),
      transaction: async (fn: (tx: Record<string, Function>) => Promise<unknown>) => {
        const tx = {
          update: () => makeUpdateChain(),
        };
        return fn(tx);
      },
    };
  },
}));

vi.mock('../lib/midtrans.js', () => ({
  createMidtransTransaction: vi.fn(async () => ({
    token: 'mock-snap-token-xyz',
    redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/mock-snap-token-xyz',
  })),
  cancelTransaction: vi.fn(async () => undefined),
  verifyMidtransSignature: vi.fn(async () => mockSignatureValid),
}));

const testEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  DATABASE_URL: 'DB_TEST_CONNECTION_STRING',
  MIDTRANS_SERVER_KEY: 'SB-Mid-server-test',
};


function makeRequest(method: string, path: string, options: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;

  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    }),
    testEnv
  );
}

const validToken = 'valid-jwt-token';
const invalidToken = 'totally-invalid-token';

const validCallbackBody = {
  order_id: 'WILD-team-001',
  transaction_status: 'settlement',
  payment_type: 'qris',
  signature_key: 'mock-sha512-signature',
  status_code: '200',
  gross_amount: '100000.00',
};

beforeEach(() => {
  mockPaymentRow = null;
  mockUpdatedRows = [];
  mockSetCalls = [];
  authShouldSucceed = true;
  mockSignatureValid = true;
});

// =============================================================================
// Scenario 1 — All three endpoints respond (happy path, high level)
// =============================================================================
describe('Scenario 1 — Basic endpoint reachability', () => {
  it('POST /api/payment/token responds (no previous payment → new token generated)', async () => {
    mockPaymentRow = null; // no prior payment

    const res = await makeRequest('POST', '/api/payment/token', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('new_generated');
    expect(body.token).toBe('mock-snap-token-xyz');
    expect(body).toHaveProperty('expirationTime');
    expect(body.secondsRemaining).toBe(3600); // 60 * 60 — matches Midtrans expiry window
  });

  it('GET /api/payment/status responds with hasPayment true', async () => {
    const futureTime = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: 'mock-snap-token-xyz',
      transactionStatus: 'pending',
      paymentType: null,
      creationTime: new Date().toISOString(),
      expirationTime: futureTime,
    };

    const res = await makeRequest('GET', '/api/payment/status', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.hasPayment).toBe(true);
    expect(body.isTokenValid).toBe(true);
    expect(body.snapToken).toBe('mock-snap-token-xyz');
  });

  it('POST /api/payment/callback responds with success when signature is valid', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'settlement' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('settlement');
  });
});

// =============================================================================
// Scenario 2 — Unauthenticated user hits auth-guarded endpoints
// =============================================================================
describe('Scenario 2 — Unauthenticated requests', () => {
  beforeEach(() => {
    authShouldSucceed = false;
  });

  it('POST /api/payment/token without token → 401', async () => {
    const res = await makeRequest('POST', '/api/payment/token');
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('POST /api/payment/token with invalid token → 401', async () => {
    const res = await makeRequest('POST', '/api/payment/token', { token: invalidToken });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('GET /api/payment/status without token → 401', async () => {
    const res = await makeRequest('GET', '/api/payment/status');
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('GET /api/payment/status with invalid token → 401', async () => {
    const res = await makeRequest('GET', '/api/payment/status', { token: invalidToken });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('POST /api/payment/callback without signature fields → 401 (not a Supabase auth check)', async () => {
    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { order_id: 'WILD-team-001', transaction_status: 'settlement' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/missing required signature fields/i);
  });
});

// =============================================================================
// Scenario 3 — Authenticated user, full Snap Token generation logic
// =============================================================================
describe('Scenario 3 — Snap Token generation logic (authenticated)', () => {
  it('3a: No prior payment → creates new token', async () => {
    mockPaymentRow = null;

    const res = await makeRequest('POST', '/api/payment/token', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('new_generated');
    expect(body.token).toBe('mock-snap-token-xyz');
    expect(typeof body.secondsRemaining).toBe('number');
    expect(body.secondsRemaining as number).toBeGreaterThan(0);
  });

  it('3b: Prior payment is "settlement" → 400 Already Paid', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: 'old-token',
      transactionStatus: 'settlement',
      expirationTime: new Date(Date.now() + 10000).toISOString(),
    };

    const res = await makeRequest('POST', '/api/payment/token', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Payment already completed');
    expect(body.status).toBe('settlement');
  });

  it('3b-capture: Prior payment is "capture" (credit card) → 400 Already Paid', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: 'old-token',
      transactionStatus: 'capture',
      expirationTime: new Date(Date.now() + 10000).toISOString(),
    };

    const res = await makeRequest('POST', '/api/payment/token', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toBe('Payment already completed');
    expect(body.status).toBe('capture');
  });

  it('3c: Prior payment is "pending" and token is still valid → returns existing token', async () => {
    const futureExpiry = new Date(Date.now() + 3 * 60 * 1000).toISOString(); // 3 min remaining

    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: 'existing-snap-token',
      transactionStatus: 'pending',
      expirationTime: futureExpiry,
    };

    const res = await makeRequest('POST', '/api/payment/token', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('existing_active');
    expect(body.token).toBe('existing-snap-token');
    expect(body.secondsRemaining as number).toBeGreaterThan(0);
    expect(body.secondsRemaining as number).toBeLessThanOrEqual(180); // ≤ 3 min
  });

  it('3d: Prior payment is "pending" but token has expired → marks old as expire, creates new', async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString(); // already expired

    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: 'stale-token',
      transactionStatus: 'pending',
      expirationTime: pastExpiry,
    };

    const res = await makeRequest('POST', '/api/payment/token', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('new_generated');
    expect(body.token).toBe('mock-snap-token-xyz');
  });

  it('3e: Prior payment status is "expire" → creates new token', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: null,
      transactionStatus: 'expire',
      expirationTime: new Date(Date.now() - 60000).toISOString(),
    };

    const res = await makeRequest('POST', '/api/payment/token', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('new_generated');
  });

  it('3f: Prior payment status is "cancel" → creates new token', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: null,
      transactionStatus: 'cancel',
      expirationTime: new Date(Date.now() - 60000).toISOString(),
    };

    const res = await makeRequest('POST', '/api/payment/token', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('new_generated');
  });

  it('3g: Prior payment status is "failure" → creates new token', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: null,
      transactionStatus: 'failure',
      expirationTime: new Date(Date.now() - 60000).toISOString(),
    };

    const res = await makeRequest('POST', '/api/payment/token', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('new_generated');
  });

  it('3h: Prior payment status is "deny" → creates new token', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: null,
      transactionStatus: 'deny',
      expirationTime: new Date(Date.now() - 60000).toISOString(),
    };

    const res = await makeRequest('POST', '/api/payment/token', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('new_generated');
  });
});

// =============================================================================
// Scenario 4 — GET /status after token was generated
// =============================================================================
describe('Scenario 4 — GET /status after token generation', () => {
  it('4a: Pending payment within expiry → returns token and countdown', async () => {
    const futureTime = new Date(Date.now() + 4 * 60 * 1000);

    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: 'mock-snap-token-xyz',
      transactionStatus: 'pending',
      paymentType: null,
      creationTime: new Date().toISOString(),
      expirationTime: futureTime.toISOString(),
    };

    const res = await makeRequest('GET', '/api/payment/status', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.hasPayment).toBe(true);
    expect(body.status).toBe('pending');
    expect(body.isTokenValid).toBe(true);
    expect(body.snapToken).toBe('mock-snap-token-xyz');
    expect(body.secondsRemaining as number).toBeGreaterThan(0);
    expect(body.secondsRemaining as number).toBeLessThanOrEqual(240);
    expect(body).toHaveProperty('creationTime');
    expect(body).toHaveProperty('expirationTime');
  });

  it('4b: Pending payment but token has expired → isTokenValid false, snapToken null', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: 'stale-token',
      transactionStatus: 'pending',
      paymentType: null,
      creationTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expirationTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    const res = await makeRequest('GET', '/api/payment/status', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.hasPayment).toBe(true);
    expect(body.isTokenValid).toBe(false);
    expect(body.snapToken).toBeNull();
    expect(body.secondsRemaining).toBe(0);
  });

  it('4c: No payment at all → hasPayment false', async () => {
    mockPaymentRow = null;

    const res = await makeRequest('GET', '/api/payment/status', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.hasPayment).toBe(false);
  });

  it('4d: Settlement payment → status is settlement, token is not re-exposed', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: 'used-token',
      transactionStatus: 'settlement',
      paymentType: 'qris',
      creationTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expirationTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    const res = await makeRequest('GET', '/api/payment/status', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('settlement');
    expect(body.isTokenValid).toBe(false);
    expect(body.snapToken).toBeNull();
    expect(body.paymentType).toBe('qris');
  });

  it('4e: Capture payment → status is capture, token is not re-exposed', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: 'used-token',
      transactionStatus: 'capture',
      paymentType: 'credit_card',
      creationTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expirationTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    const res = await makeRequest('GET', '/api/payment/status', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('capture');
    expect(body.isTokenValid).toBe(false);
    expect(body.snapToken).toBeNull();
    expect(body.paymentType).toBe('credit_card');
  });

  it('4f: Deny payment → status is deny', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: null,
      transactionStatus: 'deny',
      paymentType: 'credit_card',
      creationTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expirationTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    const res = await makeRequest('GET', '/api/payment/status', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('deny');
    expect(body.isTokenValid).toBe(false);
  });

  it('4g: Cancel payment → status is cancel', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: null,
      transactionStatus: 'cancel',
      paymentType: 'qris',
      creationTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expirationTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    const res = await makeRequest('GET', '/api/payment/status', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('cancel');
    expect(body.isTokenValid).toBe(false);
  });

  it('4h: Expire payment → status is expire', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: null,
      transactionStatus: 'expire',
      paymentType: null,
      creationTime: new Date(Date.now() - 70 * 60 * 1000).toISOString(),
      expirationTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };

    const res = await makeRequest('GET', '/api/payment/status', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('expire');
    expect(body.isTokenValid).toBe(false);
  });

  it('4i: Failure payment → status is failure', async () => {
    mockPaymentRow = {
      orderId: 'WILD-team-001',
      snapToken: null,
      transactionStatus: 'failure',
      paymentType: null,
      creationTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      expirationTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    const res = await makeRequest('GET', '/api/payment/status', { token: validToken });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('failure');
    expect(body.isTokenValid).toBe(false);
  });
});

// =============================================================================
// Scenario 5 — POST /callback (Midtrans webhook simulation)
//
// Security: every request must carry a valid Midtrans signature_key.
// The signature is verified before any DB work is done.
// When order_id doesn't match any DB row, updated = [] (0 rows matched),
// and the handler still returns { success: true } — intentional ACK to Midtrans.
// =============================================================================
describe('Scenario 5 — POST /callback (Midtrans webhook)', () => {
  it('5a: Missing signature fields (no signature_key/status_code/gross_amount) → 401', async () => {
    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { order_id: 'WILD-team-001', transaction_status: 'settlement' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/missing required signature fields/i);
  });

  it('5b: Invalid signature → 401', async () => {
    mockSignatureValid = false;

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, signature_key: 'tampered-signature' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toMatch(/invalid signature/i);
  });

  it('5c: Missing order_id (but valid signature) → 400', async () => {
    const { order_id: _omit, ...bodyWithoutOrderId } = validCallbackBody;
    const res = await makeRequest('POST', '/api/payment/callback', {
      body: bodyWithoutOrderId,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('Missing order_id');
  });

  it('5d: Non-existent order_id (valid signature) → success:true but 0 rows updated (silent ACK)', async () => {
    mockUpdatedRows = []; // DB update matches nothing

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, order_id: 'WILD-nonexistent-order' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('5e: Valid settlement callback → marks order as settled', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'settlement' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('settlement');
    expect(body.orderId).toBe('WILD-team-001');
  });

  it('5f: Callback with "pending" status', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'pending', payment_type: null },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('pending');
  });

  it('5g: Callback with "expire" status', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'expire', payment_type: null },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('expire');
  });

  it('5h: Callback with unknown transaction_status → falls back to "pending"', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'some_weird_status' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('pending'); // default case in switch
  });

  it('5i: Valid capture callback (credit card) → marks order as captured and team as Paid', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'capture', payment_type: 'credit_card' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('capture');
    expect(body.orderId).toBe('WILD-team-001');
  });

  it('5j: Idempotency — second settlement hits terminal guard and returns existing status', async () => {
    mockPaymentRow = { transactionStatus: 'settlement', orderId: 'WILD-team-001' };
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'settlement' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('settlement');
    expect(mockSetCalls).toHaveLength(0);
  });

  it('5k: Callback with "deny" status (credit card declined)', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'deny', payment_type: 'credit_card' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('deny');
    expect(mockSetCalls.some(c => c.status === 'Paid')).toBe(false);
  });

  it('5l: Callback with "cancel" status (user cancelled mid-payment)', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'cancel', payment_type: 'qris' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('cancel');
    expect(mockSetCalls.some(c => c.status === 'Paid')).toBe(false);
  });

  it('5m: Callback with "failure" status', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'failure' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('failure');
    expect(mockSetCalls.some(c => c.status === 'Paid')).toBe(false);
  });

  it('5n: Out-of-order — settlement then deny → deny is rejected, settlement preserved', async () => {
    mockPaymentRow = { transactionStatus: 'settlement', orderId: 'WILD-team-001' };
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'deny' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('settlement');
    expect(mockSetCalls).toHaveLength(0);
  });

  it('5o: Out-of-order — capture then cancel → cancel is rejected, capture preserved', async () => {
    mockPaymentRow = { transactionStatus: 'capture', orderId: 'WILD-team-001' };
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'cancel' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('capture');
    expect(mockSetCalls).toHaveLength(0);
  });

  it('5p: Capture with fraud_status "accept" → marks team as Paid', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: {
        ...validCallbackBody,
        transaction_status: 'capture',
        payment_type: 'credit_card',
        fraud_status: 'accept',
      },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('capture');
    expect(mockSetCalls.some(c => c.status === 'Paid')).toBe(true);
  });

  it('5q: Capture with fraud_status "challenge" → does NOT mark team as Paid', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: {
        ...validCallbackBody,
        transaction_status: 'capture',
        payment_type: 'credit_card',
        fraud_status: 'challenge',
      },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('capture');
    expect(mockSetCalls.some(c => c.status === 'Paid')).toBe(false);
  });

  it('5r: Capture with fraud_status "deny" → does NOT mark team as Paid', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: {
        ...validCallbackBody,
        transaction_status: 'capture',
        payment_type: 'credit_card',
        fraud_status: 'deny',
      },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('capture');
    expect(mockSetCalls.some(c => c.status === 'Paid')).toBe(false);
  });

  it('5s: Capture without fraud_status (non-CC fallback) → marks team as Paid', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: {
        ...validCallbackBody,
        transaction_status: 'capture',
        payment_type: 'credit_card',
      },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('capture');
    expect(mockSetCalls.some(c => c.status === 'Paid')).toBe(true);
  });

  it('5t: Out-of-order — settlement then pending → pending is rejected', async () => {
    mockPaymentRow = { transactionStatus: 'settlement', orderId: 'WILD-team-001' };

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { ...validCallbackBody, transaction_status: 'pending' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('settlement');
    expect(mockSetCalls).toHaveLength(0);
  });
});
