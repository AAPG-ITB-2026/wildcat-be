import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../types/index.js';

const { mockCreateDb } = vi.hoisted(() => ({
    mockCreateDb: vi.fn(),
}));

vi.mock('../../db/index.js', () => ({
    createDb: mockCreateDb,
}));

import { adminMiddleware } from '../adminAuth.js';

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

function createApp() {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();

    app.use('*', async (c, next) => {
        c.set('user', { id: 'user-1' } as any);
        await next();
    });

    app.use('*', adminMiddleware);
    app.get('/secure', (c) => c.json({ success: true }, 200));

    return app;
}

function mockCommitteeResult(role: string | null) {
    const result = role ? [{ role }] : [];
    mockCreateDb.mockReturnValue({
        select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(result),
                }),
            }),
        }),
    });
}

describe('adminMiddleware', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should allow Admin role', async () => {
        mockCommitteeResult('Admin');

        const app = createApp();
        const res = await app.request('/secure', {}, fakeEnv as any);

        expect(res.status).toBe(200);
    });

    it('should allow Committee role', async () => {
        mockCommitteeResult('Committee');

        const app = createApp();
        const res = await app.request('/secure', {}, fakeEnv as any);

        expect(res.status).toBe(200);
    });

    it('should block non-committee account', async () => {
        mockCommitteeResult(null);

        const app = createApp();
        const res = await app.request('/secure', {}, fakeEnv as any);

        expect(res.status).toBe(403);
    });

    it('should block unexpected role value', async () => {
        mockCommitteeResult('Reviewer');

        const app = createApp();
        const res = await app.request('/secure', {}, fakeEnv as any);

        expect(res.status).toBe(403);
    });
});
