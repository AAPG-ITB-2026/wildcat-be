import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const {
    mockListPaymentVerificationReviews,
    mockListAdministrationVerificationReviews,
    mockListStageSubmissionReviews,
    mockCreateDb,
    mockGetStorage,
    mockCreateDrizzleAdminReviewRepo,
} = vi.hoisted(() => ({
    mockListPaymentVerificationReviews: vi.fn(),
    mockListAdministrationVerificationReviews: vi.fn(),
    mockListStageSubmissionReviews: vi.fn(),
    mockCreateDb: vi.fn(),
    mockGetStorage: vi.fn(),
    mockCreateDrizzleAdminReviewRepo: vi.fn(),
}));

vi.mock('../../../db/index.js', () => ({
    createDb: mockCreateDb,
}));

vi.mock('../../../infrastructure/storage/get-storage.js', () => ({
    getStorage: mockGetStorage,
}));

vi.mock('../adapters/drizzle-admin-review.adapter.js', () => ({
    createDrizzleAdminReviewRepo: mockCreateDrizzleAdminReviewRepo,
}));

vi.mock('../admin.service.js', () => ({
    listPaymentVerificationReviews: mockListPaymentVerificationReviews,
    listAdministrationVerificationReviews: mockListAdministrationVerificationReviews,
    listStageSubmissionReviews: mockListStageSubmissionReviews,
}));

import admin from '../admin.route.js';

interface RouteSuccessBody {
    success: true;
    data: any[];
}

interface RouteErrorBody {
    success: false;
    error?: {
        code?: string;
    };
}

function createApp() {
    const app = new Hono();
    app.route('/api/admin', admin);
    return app;
}

const fakeEnv = {
    HYPERDRIVE: { connectionString: 'DB_FAKE_CONNECTION_STRING' },
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET_NAME: 'bucket',
    R2_PUBLIC_URL: 'https://cdn.example.com',
    DATABASE_URL: 'DB_LEGACY_CONNECTION_STRING',
};

describe('admin.route BE22 endpoints', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        mockCreateDb.mockReturnValue({});
        mockGetStorage.mockReturnValue({});
        mockCreateDrizzleAdminReviewRepo.mockReturnValue({});
    });

    it('GET /api/admin/transactions should return payment verification list', async () => {
        mockListPaymentVerificationReviews.mockResolvedValue([
            {
                transactionId: 'tx-1',
                team: { id: 'team-1', name: 'Alpha', institution: 'Uni A' },
                orderId: 'ORDER-1',
                amount: '100000.00',
                paymentType: 'bank_transfer',
                verificationStatus: 'Pending',
                verifiedBy: null,
                rejectionNotes: null,
                createdAt: '2026-03-07T00:00:00.000Z',
                paymentProof: {
                    originalFileRef: 'team-1/payment/receipt.pdf',
                    objectKey: 'team-1/payment/receipt.pdf',
                    downloadUrl: 'https://signed.example.com',
                },
            },
        ]);

        const app = createApp();
        const res = await app.request('/api/admin/transactions', {}, fakeEnv);
        const body = (await res.json()) as RouteSuccessBody;

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
        expect(body.data[0]?.transactionId).toBe('tx-1');
        expect(mockListPaymentVerificationReviews).toHaveBeenCalledTimes(1);
        expect(mockListPaymentVerificationReviews).toHaveBeenCalledWith(
            expect.any(Object),
            { limit: 20, offset: 0 },
        );
    });

    it('GET /api/admin/teams/administration should return administration verification list', async () => {
        mockListAdministrationVerificationReviews.mockResolvedValue([
            {
                team: { id: 'team-1', name: 'Alpha', institution: 'Uni A' },
                verificationStatus: 'Pending',
                verifiedBy: null,
                rejectionNotes: null,
                documents: {
                    leadKtm: { originalFileRef: null, objectKey: null, downloadUrl: null },
                    twibbonProof: { originalFileRef: null, objectKey: null, downloadUrl: null },
                    posterProof: { originalFileRef: null, objectKey: null, downloadUrl: null },
                },
            },
        ]);

        const app = createApp();
        const res = await app.request('/api/admin/teams/administration', {}, fakeEnv);
        const body = (await res.json()) as RouteSuccessBody;

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data[0]?.team?.id).toBe('team-1');
        expect(mockListAdministrationVerificationReviews).toHaveBeenCalledTimes(1);
        expect(mockListAdministrationVerificationReviews).toHaveBeenCalledWith(
            expect.any(Object),
            { limit: 20, offset: 0 },
        );
    });

    it('GET /api/admin/stages/:stage_id/submissions should return stage submissions for valid UUID', async () => {
        const stageId = '550e8400-e29b-41d4-a716-446655440000';
        mockListStageSubmissionReviews.mockResolvedValue([
            {
                submissionId: 'sub-1',
                team: { id: 'team-1', name: 'Alpha', institution: 'Uni A' },
                requirement: { id: 'req-1', documentName: 'Paper' },
                isValid: false,
                verifiedBy: null,
                submittedAt: '2026-03-07T00:00:00.000Z',
                file: {
                    originalFileRef: 'submissions/team-1/req-1/file.pdf',
                    objectKey: 'submissions/team-1/req-1/file.pdf',
                    downloadUrl: 'https://signed.example.com',
                },
            },
        ]);

        const app = createApp();
        const res = await app.request(`/api/admin/stages/${stageId}/submissions`, {}, fakeEnv);
        const body = (await res.json()) as RouteSuccessBody;

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data[0]?.submissionId).toBe('sub-1');
        expect(mockListStageSubmissionReviews).toHaveBeenCalledWith(
            stageId,
            expect.any(Object),
            { limit: 20, offset: 0 },
        );
    });

    it('GET /api/admin/transactions should forward explicit pagination query', async () => {
        mockListPaymentVerificationReviews.mockResolvedValue([]);

        const app = createApp();
        const res = await app.request('/api/admin/transactions?limit=5&offset=10', {}, fakeEnv);
        const body = (await res.json()) as RouteSuccessBody;

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(mockListPaymentVerificationReviews).toHaveBeenCalledWith(
            expect.any(Object),
            { limit: 5, offset: 10 },
        );
    });

    it('GET /api/admin/transactions should reject invalid pagination query', async () => {
        const app = createApp();
        const res = await app.request('/api/admin/transactions?limit=0', {}, fakeEnv);
        const body = (await res.json()) as RouteErrorBody;

        expect(res.status).toBe(400);
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('VALIDATION_ERROR');
        expect(mockListPaymentVerificationReviews).not.toHaveBeenCalled();
    });

    it('GET /api/admin/stages/:stage_id/submissions should reject invalid UUID', async () => {
        const app = createApp();
        const res = await app.request('/api/admin/stages/not-a-uuid/submissions', {}, fakeEnv);
        const body = (await res.json()) as RouteErrorBody;

        expect(res.status).toBe(400);
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('VALIDATION_ERROR');
        expect(mockListStageSubmissionReviews).not.toHaveBeenCalled();
    });

    it('GET /api/admin/transactions should return 500 when service throws', async () => {
        mockListPaymentVerificationReviews.mockRejectedValue(new Error('boom'));

        const app = createApp();
        const res = await app.request('/api/admin/transactions', {}, fakeEnv);
        const body = (await res.json()) as RouteErrorBody;

        expect(res.status).toBe(500);
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('INTERNAL_ERROR');
    });
});
