import { Hono } from 'hono';

import { getGuidebookUrl } from './assets.service.js';
import { AssetError } from './assets.errors.js';
import { createDb } from '../../db/index.js';
import type { Env, Variables } from '../../types/index.js';

const assets = new Hono<{ Bindings: Env; Variables: Variables }>();

assets.get('/guidebook/:competitionId', async (c) => {
    try {
        const competitionId = c.req.param('competitionId');
        const db = createDb(c.env);

        const result = await getGuidebookUrl(competitionId, { db, publicAssetUrl: c.env.PUBLIC_ASSET_URL });

        c.header('Cache-Control', 'public, max-age=3600');
        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        return handleServiceError(c, error);
    }
});

const ERROR_STATUS_MAP: Record<string, number> = {
    INVALID_COMPETITION_ID: 400,
    COMPETITION_NOT_FOUND: 404,
    GUIDEBOOK_NOT_AVAILABLE: 404,
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
