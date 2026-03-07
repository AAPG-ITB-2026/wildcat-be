import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const {
    mockCreateDb,
    mockListMyReleasedResults,
    mockAuthMiddleware,
    mockCreateDrizzleTeamAccountRepo,
    mockCreateDrizzleTeamResultsRepo,
} = vi.hoisted(() => ({
    mockCreateDb: vi.fn(),
    mockListMyReleasedResults: vi.fn(),
    mockAuthMiddleware: vi.fn(),
    mockCreateDrizzleTeamAccountRepo: vi.fn(),
    mockCreateDrizzleTeamResultsRepo: vi.fn(),
}));

vi.mock('../../../db/index.js', () => ({
    createDb: mockCreateDb,
}));

vi.mock('../../../middlewares/auth.js', () => ({
    authMiddleware: mockAuthMiddleware,
}));

vi.mock('../teams-results.service.js', () => ({
    listMyReleasedResults: mockListMyReleasedResults,
}));

vi.mock('../adapters/drizzle-team-results.adapter.js', () => ({
    createDrizzleTeamAccountRepo: mockCreateDrizzleTeamAccountRepo,
    createDrizzleTeamResultsRepo: mockCreateDrizzleTeamResultsRepo,
}));

import teamsRoute from '../teams.route.js';
import { TeamResultsError } from '../teams-results.errors.js';

function createApp() {
    const app = new Hono();
    app.route('/api/teams', teamsRoute);
    return app;
}

const fakeEnv = {
    HYPERDRIVE: { connectionString: 'postgres://fake' },
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    R2_ACCOUNT_ID: 'acc',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_BUCKET_NAME: 'bucket',
    R2_PUBLIC_URL: 'https://cdn.example.com',
    DATABASE_URL: 'postgres://legacy',
};

describe('teams.route /my-results', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockCreateDb.mockReturnValue({});
        mockCreateDrizzleTeamAccountRepo.mockReturnValue({});
        mockCreateDrizzleTeamResultsRepo.mockReturnValue({});

        mockAuthMiddleware.mockImplementation(async (c: any, next: any) => {
            c.set('user', { id: 'team-1' });
            await next();
        });
    });

    it('should return released scores for authenticated team', async () => {
        mockListMyReleasedResults.mockResolvedValue([
            { stageName: 'Semifinal', finalScore: 85.3, feedback: 'Good effort' },
        ]);

        const app = createApp();
        const res = await app.request('/api/teams/my-results', {}, fakeEnv as any);
        const body = (await res.json()) as {
            success: boolean;
            data: Array<{ stageName: string; finalScore: number; feedback: string | null }>;
        };

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data).toHaveLength(1);
        expect(body.data[0]?.stageName).toBe('Semifinal');
        expect(mockListMyReleasedResults).toHaveBeenCalledWith(
            'team-1',
            expect.objectContaining({
                accounts: expect.anything(),
                results: expect.anything(),
            }),
        );
    });

    it('should map service business error to 403', async () => {
        mockListMyReleasedResults.mockRejectedValue(
            new TeamResultsError('TEAM_ACCOUNT_REQUIRED', 'Team account is required to access results'),
        );

        const app = createApp();
        const res = await app.request('/api/teams/my-results', {}, fakeEnv as any);
        const body = (await res.json()) as {
            success: boolean;
            error?: { code?: string };
        };

        expect(res.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('TEAM_ACCOUNT_REQUIRED');
    });

    it('should return 401 when auth middleware rejects request', async () => {
        mockAuthMiddleware.mockImplementation(async (c: any) => {
            return c.json({ error: 'Unauthorized: Missing or invalid token' }, 401);
        });

        const app = createApp();
        const res = await app.request('/api/teams/my-results', {}, fakeEnv as any);

        expect(res.status).toBe(401);
        expect(mockListMyReleasedResults).not.toHaveBeenCalled();
    });

    it('should return 500 on unexpected error', async () => {
        mockListMyReleasedResults.mockRejectedValue(new Error('boom'));

        const app = createApp();
        const res = await app.request('/api/teams/my-results', {}, fakeEnv as any);
        const body = (await res.json()) as {
            success: boolean;
            error?: { code?: string };
        };

        expect(res.status).toBe(500);
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('INTERNAL_ERROR');
    });
});
