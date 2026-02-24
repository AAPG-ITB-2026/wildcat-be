import { Hono } from 'hono';

import { getRestrictedAsset } from './assets.service.js';
import { AssetError } from './assets.errors.js';
import type { AssetServiceDeps } from './assets.types.js';
import { createR2AssetStorage } from './adapters/r2-asset-storage.adapter.js';
import { createDrizzleAssetTeamRepo } from './adapters/drizzle-asset-team.adapter.js';
import { createDb } from '../../db/index.js';
import type { Env, Variables } from '../../types/index.js';

const assets = new Hono<{ Bindings: Env; Variables: Variables }>();

function buildDeps(env: Env): AssetServiceDeps {
    const db = createDb(env);
    return {
        storage: createR2AssetStorage({
            accountId: env.R2_ACCOUNT_ID,
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
            bucketName: env.R2_BUCKET_NAME,
        }),
        teams: createDrizzleAssetTeamRepo(db),
    };
}

assets.get('/:filename', async (c) => {
    try {
        const user = c.get('user');
        const fileName = c.req.param('filename');
        const deps = buildDeps(c.env);

        const result = await getRestrictedAsset(user.id, fileName, deps);

        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        return handleServiceError(c, error);
    }
});

const ERROR_STATUS_MAP: Record<string, number> = {
    TEAM_NOT_FOUND: 404,
    NOT_REGISTERED: 403,
    ASSET_NOT_FOUND: 404,
    SIGNED_URL_FAILED: 502,
    INVALID_FILENAME: 400,
};

function handleServiceError(c: any, error: unknown) {
    if (error instanceof AssetError) {
        const status = ERROR_STATUS_MAP[error.code] ?? 500;
        return c.json(
            {
                success: false,
                error: { code: error.code, message: error.message },
            },
            status,
        );
    }

    // TODO: Replace console.error with structured logger
    console.error('[assets] Unexpected error:', error);
    return c.json(
        {
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        },
        500,
    );
}

export default assets;
