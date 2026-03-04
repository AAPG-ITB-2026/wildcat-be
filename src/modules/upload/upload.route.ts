import { Hono } from 'hono';

import { signUploadSchema, confirmUploadSchema } from './upload.schema.js';
import { generateSignedUploadUrl, confirmDocumentUpload } from './upload.service.js';
import { UploadError } from './upload.errors.js';
import type { UploadServiceDeps } from './upload.types.js';
import { createR2Storage } from './adapters/r2-storage.adapter.js';
import { createDrizzleDocumentRepo } from './adapters/drizzle-document.adapter.js';
import { createDrizzleTeamRepo } from './adapters/drizzle-team.adapter.js';
import { createDb } from '../../db/index.js';
import type { Env } from '../../types/index.js';

const upload = new Hono<{ Bindings: Env }>();
const storageCache = new Map<string, UploadServiceDeps['storage']>();

function getStorage(env: Env): UploadServiceDeps['storage'] {
    const key = [
        env.R2_ACCOUNT_ID,
        env.R2_ACCESS_KEY_ID,
        env.R2_SECRET_ACCESS_KEY,
        env.R2_BUCKET_NAME,
        env.R2_PUBLIC_URL,
    ].join('|');
    const cached = storageCache.get(key);
    if (cached) {
        return cached;
    }

    const storage = createR2Storage({
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucketName: env.R2_BUCKET_NAME,
        publicUrl: env.R2_PUBLIC_URL,
    });
    storageCache.set(key, storage);
    return storage;
}

function buildDeps(env: Env): UploadServiceDeps {
    const db = createDb(env);
    return {
        storage: getStorage(env),
        documents: createDrizzleDocumentRepo(db),
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
                        details: parseResult.error.flatten().fieldErrors,
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
                        details: parseResult.error.flatten().fieldErrors,
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
    INVALID_FILE_PATH: 422,
    INVALID_CONTENT_TYPE: 422,
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
