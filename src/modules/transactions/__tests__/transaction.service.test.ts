import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generatePaymentSignedUrl, submitPaymentProof } from '../transaction.service.js';
import { TransactionError } from '../transaction.errors.js';
import type { TransactionServiceDeps, TransactionRecord, TeamWithCompetition } from '../transaction.types.js';
import {
    requestPaymentUrlSchema,
    submitPaymentProofSchema,
    PAYMENT_ALLOWED_CONTENT_TYPES,
} from '../transaction.schema.js';

const TEAM_ID = '550e8400-e29b-41d4-a716-446655440000';
const COMPETITION_ID = 'c0000000-0000-0000-0000-000000000001';
const FUTURE_DEADLINE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST_DEADLINE = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const MOCK_TEAM_EARLY_BIRD: TeamWithCompetition = {
    id: TEAM_ID,
    competitionId: COMPETITION_ID,
    earlyBirdFee: '150000.00',
    normalBirdFee: '200000.00',
    earlyBirdDeadline: FUTURE_DEADLINE,
};

const MOCK_TEAM_NORMAL: TeamWithCompetition = {
    id: TEAM_ID,
    competitionId: COMPETITION_ID,
    earlyBirdFee: '150000.00',
    normalBirdFee: '200000.00',
    earlyBirdDeadline: PAST_DEADLINE,
};

const MOCK_TRANSACTION: TransactionRecord = {
    id: 'tx-0001',
    teamId: TEAM_ID,
    orderId: `MANUAL-${TEAM_ID.substring(0, 8)}-1234567890`,
    amount: '150000.00',
    paymentType: 'Bank Transfer',
    paymentProofUrl: 'wildcat2026/team-id/payment_proof_receipt.jpg',
    verificationStatus: 'Pending',
    verifiedBy: null,
    rejectionNotes: null,
    createdAt: new Date(),
};

function createMockDeps(overrides?: Partial<TransactionServiceDeps>): TransactionServiceDeps {
    return {
        storage: {
            createSignedUploadUrl: vi.fn().mockResolvedValue({
                data: { signedUrl: 'https://r2.example.com/signed-put-url', path: 'wildcat2026/team-id/payment_proof_receipt.jpg' },
                error: null,
            }),
            createSignedDownloadUrl: vi.fn().mockResolvedValue({
                data: 'https://r2.example.com/signed-get-url',
                error: null,
            }),
            listFiles: vi.fn().mockResolvedValue({ data: [], error: null }),
            headFile: vi.fn().mockResolvedValue({
                data: { contentType: 'image/jpeg', contentLength: 500_000 },
                error: null,
            }),
            getPublicUrl: vi.fn().mockReturnValue('https://cdn.example.com/public/file.jpg'),
        },
        transactions: {
            findByTeamId: vi.fn().mockResolvedValue(null),
            findById: vi.fn().mockResolvedValue(null),
            upsertPaymentProof: vi.fn().mockResolvedValue(MOCK_TRANSACTION),
            updateVerificationStatus: vi.fn().mockResolvedValue(MOCK_TRANSACTION),
        },
        teams: {
            findTeamWithCompetition: vi.fn().mockResolvedValue(MOCK_TEAM_EARLY_BIRD),
        },
        ...overrides,
    };
}

describe('requestPaymentUrlSchema', () => {
    const validBody = {
        fileName: 'receipt.jpg',
        contentType: 'image/jpeg' as const,
    };

    it('should accept a valid request body', () => {
        expect(requestPaymentUrlSchema.safeParse(validBody).success).toBe(true);
    });

    it('should accept .pdf file with application/pdf', () => {
        const result = requestPaymentUrlSchema.safeParse({
            fileName: 'payment.pdf',
            contentType: 'application/pdf',
        });
        expect(result.success).toBe(true);
    });

    it('should accept .png file with image/png', () => {
        const result = requestPaymentUrlSchema.safeParse({
            fileName: 'proof.png',
            contentType: 'image/png',
        });
        expect(result.success).toBe(true);
    });

    it('should reject missing fileName', () => {
        const result = requestPaymentUrlSchema.safeParse({ contentType: 'image/jpeg' });
        expect(result.success).toBe(false);
    });

    it('should reject empty fileName', () => {
        const result = requestPaymentUrlSchema.safeParse({ fileName: '', contentType: 'image/jpeg' });
        expect(result.success).toBe(false);
    });

    it('should reject invalid file extension (.webp)', () => {
        const result = requestPaymentUrlSchema.safeParse({
            fileName: 'photo.webp',
            contentType: 'image/jpeg',
        });
        expect(result.success).toBe(false);
    });

    it('should reject invalid file extension (.gif)', () => {
        const result = requestPaymentUrlSchema.safeParse({
            fileName: 'animated.gif',
            contentType: 'image/jpeg',
        });
        expect(result.success).toBe(false);
    });

    it('should reject unsupported contentType (image/webp)', () => {
        const result = requestPaymentUrlSchema.safeParse({
            fileName: 'photo.jpg',
            contentType: 'image/webp',
        });
        expect(result.success).toBe(false);
    });

    it('should reject unsupported contentType (application/zip)', () => {
        const result = requestPaymentUrlSchema.safeParse({
            fileName: 'archive.pdf',
            contentType: 'application/zip',
        });
        expect(result.success).toBe(false);
    });

    it('should accept every allowed contentType', () => {
        for (const ct of PAYMENT_ALLOWED_CONTENT_TYPES) {
            const ext = ct === 'application/pdf' ? 'pdf' : ct.split('/')[1] === 'jpeg' ? 'jpg' : ct.split('/')[1];
            const result = requestPaymentUrlSchema.safeParse({
                fileName: `file.${ext}`,
                contentType: ct,
            });
            expect(result.success).toBe(true);
        }
    });

    it('should reject fileName longer than 255 characters', () => {
        const result = requestPaymentUrlSchema.safeParse({
            fileName: 'a'.repeat(252) + '.jpg',
            contentType: 'image/jpeg',
        });
        expect(result.success).toBe(false);
    });
});

describe('submitPaymentProofSchema', () => {
    const validBody = {
        file_url: 'wildcat2026/team-id/payment_proof_receipt.jpg',
        payment_method: 'Bank Transfer',
    };

    it('should accept a valid request body', () => {
        expect(submitPaymentProofSchema.safeParse(validBody).success).toBe(true);
    });

    it('should reject missing file_url', () => {
        const result = submitPaymentProofSchema.safeParse({ payment_method: 'Bank Transfer' });
        expect(result.success).toBe(false);
    });

    it('should reject empty file_url', () => {
        const result = submitPaymentProofSchema.safeParse({ file_url: '', payment_method: 'Bank Transfer' });
        expect(result.success).toBe(false);
    });

    it('should reject missing payment_method', () => {
        const result = submitPaymentProofSchema.safeParse({ file_url: 'some-url' });
        expect(result.success).toBe(false);
    });

    it('should reject empty payment_method', () => {
        const result = submitPaymentProofSchema.safeParse({ file_url: 'some-url', payment_method: '' });
        expect(result.success).toBe(false);
    });

    it('should accept any non-empty string as payment_method', () => {
        for (const method of ['Bank Transfer', 'QRIS', 'OVO', 'GoPay', 'Cash']) {
            const result = submitPaymentProofSchema.safeParse({ file_url: 'some-url', payment_method: method });
            expect(result.success).toBe(true);
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 1 — generatePaymentSignedUrl
// ═════════════════════════════════════════════════════════════════════════════
describe('generatePaymentSignedUrl', () => {
    const input = { fileName: 'receipt.jpg', contentType: 'image/jpeg' as const };

    it('should return signedUrl and path for a valid team', async () => {
        const deps = createMockDeps();
        const result = await generatePaymentSignedUrl(input, TEAM_ID, deps);

        expect(result.signedUrl).toBe('https://r2.example.com/signed-put-url');
        expect(result.path).toBe('wildcat2026/team-id/payment_proof_receipt.jpg');
        expect(deps.teams.findTeamWithCompetition).toHaveBeenCalledWith(TEAM_ID);
    });

    it('should call storage.createSignedUploadUrl with correct path and contentType', async () => {
        const deps = createMockDeps();
        await generatePaymentSignedUrl(input, TEAM_ID, deps);

        expect(deps.storage.createSignedUploadUrl).toHaveBeenCalledWith(
            expect.stringContaining(`${TEAM_ID}/payment_proof_receipt.jpg`),
            { contentType: 'image/jpeg' },
        );
    });

    it('should throw TEAM_NOT_FOUND when team does not exist', async () => {
        const deps = createMockDeps({
            teams: { findTeamWithCompetition: vi.fn().mockResolvedValue(null) },
        });

        await expect(generatePaymentSignedUrl(input, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);

        try {
            await generatePaymentSignedUrl(input, TEAM_ID, deps);
        } catch (e) {
            expect((e as TransactionError).code).toBe('TEAM_NOT_FOUND');
        }
    });

    it('should throw SIGNED_URL_FAILED when R2 returns an error', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                createSignedUploadUrl: vi.fn().mockResolvedValue({
                    data: null,
                    error: new Error('R2 network failure'),
                }),
            },
        });

        await expect(generatePaymentSignedUrl(input, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);

        try {
            await generatePaymentSignedUrl(input, TEAM_ID, deps);
        } catch (e) {
            expect((e as TransactionError).code).toBe('SIGNED_URL_FAILED');
            expect((e as TransactionError).message).toContain('R2 network failure');
        }
    });

    it('should throw SIGNED_URL_FAILED when R2 returns null data with no error', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                createSignedUploadUrl: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                }),
            },
        });

        await expect(generatePaymentSignedUrl(input, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);

        try {
            await generatePaymentSignedUrl(input, TEAM_ID, deps);
        } catch (e) {
            expect((e as TransactionError).code).toBe('SIGNED_URL_FAILED');
        }
    });

    it('should work with .pdf contentType', async () => {
        const deps = createMockDeps();
        const pdfInput = { fileName: 'receipt.pdf', contentType: 'application/pdf' as const };
        const result = await generatePaymentSignedUrl(pdfInput, TEAM_ID, deps);

        expect(result.signedUrl).toBeDefined();
        expect(deps.storage.createSignedUploadUrl).toHaveBeenCalledWith(
            expect.stringContaining('payment_proof_receipt.pdf'),
            { contentType: 'application/pdf' },
        );
    });

    it('should work with .png contentType', async () => {
        const deps = createMockDeps();
        const pngInput = { fileName: 'receipt.png', contentType: 'image/png' as const };
        const result = await generatePaymentSignedUrl(pngInput, TEAM_ID, deps);

        expect(result.signedUrl).toBeDefined();
        expect(deps.storage.createSignedUploadUrl).toHaveBeenCalledWith(
            expect.stringContaining('payment_proof_receipt.png'),
            { contentType: 'image/png' },
        );
    });
});

// ═════════════════════════════════════════════════════════════════════════════
// STEP 2 — submitPaymentProof
// ═════════════════════════════════════════════════════════════════════════════
describe('submitPaymentProof', () => {
    const validInput = {
        file_url: 'wildcat2026/team-id/payment_proof_receipt.jpg',
        payment_method: 'Bank Transfer',
    };

    it('should upsert a transaction and return it on valid input', async () => {
        const deps = createMockDeps();
        const result = await submitPaymentProof(validInput, TEAM_ID, deps);

        expect(result.transaction).toBeDefined();
        expect(result.transaction.teamId).toBe(TEAM_ID);
        expect(result.transaction.verificationStatus).toBe('Pending');
        expect(deps.transactions.upsertPaymentProof).toHaveBeenCalledOnce();
    });

    it('should pass the file_url to upsertPaymentProof', async () => {
        const deps = createMockDeps();
        await submitPaymentProof(validInput, TEAM_ID, deps);

        expect(deps.transactions.upsertPaymentProof).toHaveBeenCalledWith(
            TEAM_ID,
            validInput.file_url,
            validInput.payment_method,
            expect.any(String),
            expect.any(String),
        );
    });

    it('should use early bird fee when within early bird deadline', async () => {
        const deps = createMockDeps({
            teams: { findTeamWithCompetition: vi.fn().mockResolvedValue(MOCK_TEAM_EARLY_BIRD) },
        });

        await submitPaymentProof(validInput, TEAM_ID, deps);

        expect(deps.transactions.upsertPaymentProof).toHaveBeenCalledWith(
            TEAM_ID,
            validInput.file_url,
            validInput.payment_method,
            '150000.00',
            expect.any(String),
        );
    });

    it('should use normal fee when past early bird deadline', async () => {
        const deps = createMockDeps({
            teams: { findTeamWithCompetition: vi.fn().mockResolvedValue(MOCK_TEAM_NORMAL) },
        });

        await submitPaymentProof(validInput, TEAM_ID, deps);

        expect(deps.transactions.upsertPaymentProof).toHaveBeenCalledWith(
            TEAM_ID,
            validInput.file_url,
            validInput.payment_method,
            '200000.00',
            expect.any(String),
        );
    });

    it('should generate orderId with MANUAL- prefix', async () => {
        const deps = createMockDeps();
        await submitPaymentProof(validInput, TEAM_ID, deps);

        const calledOrderId = (deps.transactions.upsertPaymentProof as ReturnType<typeof vi.fn>).mock.calls[0][4];
        expect(calledOrderId).toMatch(/^MANUAL-/);
        expect(calledOrderId).toContain(TEAM_ID.substring(0, 8));
    });

    // ─── Team not found ──────────────────────────────────────────────────────
    it('should throw TEAM_NOT_FOUND when team does not exist', async () => {
        const deps = createMockDeps({
            teams: { findTeamWithCompetition: vi.fn().mockResolvedValue(null) },
        });

        await expect(submitPaymentProof(validInput, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);

        try {
            await submitPaymentProof(validInput, TEAM_ID, deps);
        } catch (e) {
            expect((e as TransactionError).code).toBe('TEAM_NOT_FOUND');
        }
    });

    it('should throw FILE_NOT_FOUND when R2 headFile returns error', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({
                    data: null,
                    error: new Error('Object not found'),
                }),
            },
        });

        await expect(submitPaymentProof(validInput, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);

        try {
            await submitPaymentProof(validInput, TEAM_ID, deps);
        } catch (e) {
            expect((e as TransactionError).code).toBe('FILE_NOT_FOUND');
        }
    });

    it('should throw FILE_NOT_FOUND when headFile returns null data', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({ data: null, error: null }),
            },
        });

        await expect(submitPaymentProof(validInput, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);

        try {
            await submitPaymentProof(validInput, TEAM_ID, deps);
        } catch (e) {
            expect((e as TransactionError).code).toBe('FILE_NOT_FOUND');
        }
    });

    it('should throw FILE_TOO_LARGE when file exceeds 2MB', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'image/jpeg', contentLength: 3 * 1024 * 1024 }, // 3MB
                    error: null,
                }),
            },
        });

        await expect(submitPaymentProof(validInput, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);

        try {
            await submitPaymentProof(validInput, TEAM_ID, deps);
        } catch (e) {
            expect((e as TransactionError).code).toBe('FILE_TOO_LARGE');
            expect((e as TransactionError).message).toContain('2MB');
        }
    });

    it('should accept a file exactly at 2MB', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'image/jpeg', contentLength: 2 * 1024 * 1024 }, // exactly 2MB
                    error: null,
                }),
            },
        });

        const result = await submitPaymentProof(validInput, TEAM_ID, deps);
        expect(result.transaction).toBeDefined();
    });

    it('should reject a file 1 byte over 2MB', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'image/jpeg', contentLength: 2 * 1024 * 1024 + 1 },
                    error: null,
                }),
            },
        });

        await expect(submitPaymentProof(validInput, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);
    });

    it('should throw INVALID_CONTENT_TYPE for image/gif', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'image/gif', contentLength: 100_000 },
                    error: null,
                }),
            },
        });

        await expect(submitPaymentProof(validInput, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);

        try {
            await submitPaymentProof(validInput, TEAM_ID, deps);
        } catch (e) {
            expect((e as TransactionError).code).toBe('INVALID_CONTENT_TYPE');
        }
    });

    it('should throw INVALID_CONTENT_TYPE for image/webp', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'image/webp', contentLength: 100_000 },
                    error: null,
                }),
            },
        });

        await expect(submitPaymentProof(validInput, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);

        try {
            await submitPaymentProof(validInput, TEAM_ID, deps);
        } catch (e) {
            expect((e as TransactionError).code).toBe('INVALID_CONTENT_TYPE');
        }
    });

    it('should throw INVALID_CONTENT_TYPE for application/zip', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'application/zip', contentLength: 100_000 },
                    error: null,
                }),
            },
        });

        await expect(submitPaymentProof(validInput, TEAM_ID, deps))
            .rejects.toThrow(TransactionError);

        try {
            await submitPaymentProof(validInput, TEAM_ID, deps);
        } catch (e) {
            expect((e as TransactionError).code).toBe('INVALID_CONTENT_TYPE');
        }
    });

    it('should accept image/jpeg', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'image/jpeg', contentLength: 100_000 },
                    error: null,
                }),
            },
        });
        const result = await submitPaymentProof(validInput, TEAM_ID, deps);
        expect(result.transaction).toBeDefined();
    });

    it('should accept image/png', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'image/png', contentLength: 100_000 },
                    error: null,
                }),
            },
        });
        const result = await submitPaymentProof(validInput, TEAM_ID, deps);
        expect(result.transaction).toBeDefined();
    });

    it('should accept application/pdf', async () => {
        const deps = createMockDeps({
            storage: {
                ...createMockDeps().storage,
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'application/pdf', contentLength: 100_000 },
                    error: null,
                }),
            },
        });
        const result = await submitPaymentProof(validInput, TEAM_ID, deps);
        expect(result.transaction).toBeDefined();
    });

    it('should strip wildcat2026/ prefix from file_url for headFile', async () => {
        const deps = createMockDeps();
        await submitPaymentProof(
            { file_url: 'wildcat2026/some-team/payment.jpg', payment_method: 'QRIS' },
            TEAM_ID,
            deps,
        );

        expect(deps.storage.headFile).toHaveBeenCalledWith('some-team/payment.jpg');
    });

    it('should extract R2 key from absolute HTTPS URL', async () => {
        const deps = createMockDeps();
        await submitPaymentProof(
            { file_url: 'https://cdn.example.com/wildcat2026/some-team/payment.jpg', payment_method: 'QRIS' },
            TEAM_ID,
            deps,
        );

        expect(deps.storage.headFile).toHaveBeenCalledWith('some-team/payment.jpg');
    });

    it('should extract R2 key from absolute URL without bucket prefix', async () => {
        const deps = createMockDeps();
        await submitPaymentProof(
            { file_url: 'https://cdn.example.com/some-team/payment.jpg', payment_method: 'QRIS' },
            TEAM_ID,
            deps,
        );

        expect(deps.storage.headFile).toHaveBeenCalledWith('some-team/payment.jpg');
    });

    it('should treat plain key as direct R2 key', async () => {
        const deps = createMockDeps();
        await submitPaymentProof(
            { file_url: 'some-team/payment.jpg', payment_method: 'QRIS' },
            TEAM_ID,
            deps,
        );

        expect(deps.storage.headFile).toHaveBeenCalledWith('some-team/payment.jpg');
    });

    it('should pass payment_method to upsert for Bank Transfer', async () => {
        const deps = createMockDeps();
        await submitPaymentProof({ ...validInput, payment_method: 'Bank Transfer' }, TEAM_ID, deps);

        expect(deps.transactions.upsertPaymentProof).toHaveBeenCalledWith(
            TEAM_ID, validInput.file_url, 'Bank Transfer', expect.any(String), expect.any(String),
        );
    });

    it('should pass payment_method to upsert for QRIS', async () => {
        const deps = createMockDeps();
        await submitPaymentProof({ ...validInput, payment_method: 'QRIS' }, TEAM_ID, deps);

        expect(deps.transactions.upsertPaymentProof).toHaveBeenCalledWith(
            TEAM_ID, validInput.file_url, 'QRIS', expect.any(String), expect.any(String),
        );
    });

    it('should call upsertPaymentProof even if a transaction already exists (re-upload)', async () => {
        const deps = createMockDeps({
            transactions: {
                ...createMockDeps().transactions,
                findByTeamId: vi.fn().mockResolvedValue(MOCK_TRANSACTION),
                upsertPaymentProof: vi.fn().mockResolvedValue({
                    ...MOCK_TRANSACTION,
                    paymentProofUrl: 'new-url.jpg',
                    verificationStatus: 'Pending',
                }),
            },
        });

        const result = await submitPaymentProof(
            { file_url: 'new-url.jpg', payment_method: 'OVO' },
            TEAM_ID,
            deps,
        );

        expect(result.transaction.verificationStatus).toBe('Pending');
        expect(deps.transactions.upsertPaymentProof).toHaveBeenCalledOnce();
    });

    it('should always set verification_status to Pending on upsert', async () => {
        const deps = createMockDeps({
            transactions: {
                ...createMockDeps().transactions,
                upsertPaymentProof: vi.fn().mockResolvedValue({
                    ...MOCK_TRANSACTION,
                    verificationStatus: 'Pending',
                }),
            },
        });

        const result = await submitPaymentProof(validInput, TEAM_ID, deps);
        expect(result.transaction.verificationStatus).toBe('Pending');
    });
});

describe('TransactionError', () => {
    it('should set code and message', () => {
        const error = new TransactionError('TEAM_NOT_FOUND', 'Team x does not exist');
        expect(error.code).toBe('TEAM_NOT_FOUND');
        expect(error.message).toBe('Team x does not exist');
        expect(error.name).toBe('TransactionError');
    });

    it('should be an instance of Error', () => {
        const error = new TransactionError('FILE_NOT_FOUND', 'oops');
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(TransactionError);
    });
});
