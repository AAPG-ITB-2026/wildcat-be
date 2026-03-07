import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { signUploadSchema, confirmUploadSchema } from './upload.schema.js';
import { generateSignedUploadUrl, confirmDocumentUpload } from './upload.service.js';
import { UploadError } from './upload.errors.js';
import type { UploadServiceDeps } from './upload.types.js';
import { createDrizzleAdministrationRepo } from './adapters/drizzle-administration.adapter.js';
import { createDrizzleTeamRepo } from './adapters/drizzle-team.adapter.js';
import { createDb } from '../../db/index.js';
import { getStorage } from '../../infrastructure/storage/get-storage.js';
import type { Env } from '../../types/index.js';

const upload = new Hono<{ Bindings: Env }>();

function buildDeps(env: Env): UploadServiceDeps {
    const db = createDb(env);
    return {
        storage: getStorage(env),
        administration: createDrizzleAdministrationRepo(db),
        teams: createDrizzleTeamRepo(db),
    };
}

upload.post('/sign', async (c) => {
    try {
        const body = await c.req.json();
        const parseResult = signUploadSchema.safeParse(body);

        if (!parseResult.success) {
            return c.json(
                {
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid request body',
                        details: z.flattenError(parseResult.error).fieldErrors,
                    },
                },
                400,
            );
        }

        const result = await generateSignedUploadUrl(parseResult.data, buildDeps(c.env));

        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        return handleServiceError(c, error);
    }
});

upload.post('/confirm', async (c) => {
    try {
        const body = await c.req.json();
        const parseResult = confirmUploadSchema.safeParse(body);

        if (!parseResult.success) {
            return c.json(
                {
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid request body',
                        details: z.flattenError(parseResult.error).fieldErrors,
                    },
                },
                400,
            );
        }

        const result = await confirmDocumentUpload(parseResult.data, buildDeps(c.env));

        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        return handleServiceError(c, error);
    }
});

const ERROR_STATUS_MAP: Record<string, number> = {
    TEAM_NOT_FOUND: 404,
    SIGNED_URL_FAILED: 502,
    FILE_NOT_FOUND: 404,
    INVALID_CONTENT_TYPE: 422,
    INVALID_FILE_PATH: 400,
    DB_WRITE_FAILED: 500,
};

function handleServiceError(c: Context<{ Bindings: Env }>, error: unknown) {
    if (error instanceof UploadError) {
        const status = (ERROR_STATUS_MAP[error.code] ?? 500) as ContentfulStatusCode;
        return c.json(
            {
                success: false,
                error: { code: error.code, message: error.message },
            },
            status,
        );
    }

    // TODO: Replace console.error with structured logger
    console.error('[upload] Unexpected error:', error);
    return c.json(
        {
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        },
        500,
    );
}

export default upload;
