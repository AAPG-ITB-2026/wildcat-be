import { Hono } from 'hono';
import { z } from 'zod';

import { signUploadSchema, confirmUploadSchema } from './upload.schema.js';
import { generateSignedUploadUrl, confirmDocumentUpload } from './upload.service.js';
import { UploadError } from './upload.errors.js';
import type { UploadServiceDeps } from './upload.types.js';
import { createR2Storage, loadR2ConfigFromEnv } from './adapters/r2-storage.adapter.js';
import { createDrizzleDocumentRepo } from './adapters/drizzle-document.adapter.js';
import { createDrizzleTeamRepo } from './adapters/drizzle-team.adapter.js';

const upload = new Hono();

let _deps: UploadServiceDeps | null = null;

function getDeps(): UploadServiceDeps {
    if (!_deps) {
        _deps = {
            storage: createR2Storage(loadR2ConfigFromEnv()),
            documents: createDrizzleDocumentRepo(),
            teams: createDrizzleTeamRepo(),
        };
    }
    return _deps;
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

        const result = await generateSignedUploadUrl(parseResult.data, getDeps());

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

        const result = await confirmDocumentUpload(parseResult.data, getDeps());

        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        return handleServiceError(c, error);
    }
});

const ERROR_STATUS_MAP: Record<string, number> = {
    TEAM_NOT_FOUND: 404,
    SIGNED_URL_FAILED: 502,
    FILE_NOT_FOUND: 404,
    DB_WRITE_FAILED: 500,
};

function handleServiceError(c: any, error: unknown) {
    if (error instanceof UploadError) {
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
