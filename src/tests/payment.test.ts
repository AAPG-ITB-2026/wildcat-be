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
 * Callback note: POST /callback has NO auth middleware (Midtrans calls it
 * server-to-server). When a non-existent order_id is sent the DB update
 * matches 0 rows and returns an empty array → the handler still returns
 * { success: true } because no error is thrown. This is intentional —
 * the webhook should always ACK to Midtrans, even for unknown orders.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../index.js';

let mockPaymentRow: Record<string, unknown> | null = null;

const mockTeamRow = {
  id: 'team-uuid-1234-5678',
  userId: 'user-uuid-aaaa-bbbb',
  leaderName: 'Budi Santoso',
  category: 'Wildcat',
  status: 'Registered',
};

const mockUser = {
  id: 'user-uuid-aaaa-bbbb',
  email: 'budi@test.com',
};

let authShouldSucceed = true;

let mockUpdatedRows: Record<string, unknown>[] = [];

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
          // Drizzle stores the table name on table[Symbol.for('drizzle:Name')].
          const drizzleName = table[Symbol.for('drizzle:Name')];
          const name = typeof drizzleName === 'string' ? drizzleName : (table._?.name ?? '');
          _table = name === 'payments' ? 'payments' : 'teams';
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: async () => {
          if (_table === 'payments') {
            return mockPaymentRow ? [mockPaymentRow] : [];
          }
          return [mockTeamRow];
        },
      };
      return chain;
    };

    const makeUpdateChain = () => {
      const chain = {
        set: () => chain,
        where: () => chain,
        returning: async () => mockUpdatedRows,
      };
      return chain;
    };

    return {
      select: makeSelectChain,
      insert: () => ({ values: async () => undefined }),
      update: () => makeUpdateChain(),
    };
  },
}));

vi.mock('../lib/midtrans.js', () => ({
  createMidtransTransaction: vi.fn(async () => ({
    token: 'mock-snap-token-xyz',
    redirect_url: 'https://app.sandbox.midtrans.com/snap/v2/vtweb/mock-snap-token-xyz',
  })),
  cancelTransaction: vi.fn(async () => undefined),
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


beforeEach(() => {
  mockPaymentRow = null;
  mockUpdatedRows = [];
  authShouldSucceed = true;
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
    expect(body.secondsRemaining).toBe(300); // 5 * 60
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

  it('POST /api/payment/callback responds with success (no auth required)', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { order_id: 'WILD-team-001', transaction_status: 'settlement', payment_type: 'qris' },
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

  it('POST /api/payment/callback has no auth guard → 400 (missing order_id) not 401', async () => {
    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { transaction_status: 'settlement' },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('Missing order_id');
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
    expect(body.snapToken).toBeNull(); // only exposed when pending+valid
    expect(body.paymentType).toBe('qris');
  });
});

// =============================================================================
// Scenario 5 — POST /callback (Midtrans webhook simulation)
//
// Key insight: callback has NO auth middleware — Midtrans sends server-to-server.
// When order_id doesn't match any DB row, updated = [] (0 rows matched),
// the handler still returns { success: true } — this is intentional ACK behavior.
// The team status is NOT updated when updated is empty.
// =============================================================================
describe('Scenario 5 — POST /callback (Midtrans webhook)', () => {
  it('5a: Missing order_id → 400', async () => {
    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { transaction_status: 'settlement' },
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('Missing order_id');
  });

  it('5b: Non-existent order_id → success:true but 0 rows updated (silent ACK)', async () => {
    mockUpdatedRows = []; // DB update matches nothing

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { order_id: 'WILD-nonexistent-order', transaction_status: 'settlement', payment_type: 'qris' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('5c: Valid settlement callback → marks order as settled', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { order_id: 'WILD-team-001', transaction_status: 'settlement', payment_type: 'qris' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('settlement');
    expect(body.orderId).toBe('WILD-team-001');
  });

  it('5d: Callback with "pending" status', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { order_id: 'WILD-team-001', transaction_status: 'pending', payment_type: null },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('pending');
  });

  it('5e: Callback with "expire" status', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { order_id: 'WILD-team-001', transaction_status: 'expire', payment_type: null },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('expire');
  });

  it('5f: Callback with unknown transaction_status → falls back to "pending"', async () => {
    mockUpdatedRows = [{ teamId: mockTeamRow.id, orderId: 'WILD-team-001' }];

    const res = await makeRequest('POST', '/api/payment/callback', {
      body: { order_id: 'WILD-team-001', transaction_status: 'some_weird_status' },
    });
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('pending'); // default case in switch
  });
});
