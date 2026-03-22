import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { signUploadSchema, confirmUploadSchema, getDocumentSchema } from './upload.schema.js';
import { generateSignedUploadUrl, confirmDocumentUpload, getDocument } from './upload.service.js';
import { UploadError } from './upload.errors.js';
import type { UploadServiceDeps } from './upload.types.js';
import { createDrizzleAdministrationRepo } from './adapters/drizzle-administration.adapter.js';
import { createDrizzleTeamRepo } from './adapters/drizzle-team.adapter.js';
import { createDb } from '../../db/index.js';
import { getStorage } from '../../lib/r2.js';
import type { Env } from '../../types/index.js';
import { logInfo, logError } from '../../middlewares/logger.js';

// We added the Variables generic here so TypeScript knows c.get('user') exists
const upload = new Hono<{ Bindings: Env; Variables: { user: { id: string } } }>();

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

        // --- IDOR PROTECTION: Verify the token matches the body ---
        const user = c.get('user');
        if (!user || user.id !== parseResult.data.teamId) {
            return c.json(
                {
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'You can only upload files for your own team' },
                },
                403,
            );
        }
        // ----------------------------------------------------------

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

        // --- IDOR PROTECTION: Verify the token matches the body ---
        const user = c.get('user');
        if (!user || user.id !== parseResult.data.teamId) {
            return c.json(
                {
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'You can only confirm files for your own team' },
                },
                403,
            );
        }
        // ----------------------------------------------------------

        const result = await confirmDocumentUpload(parseResult.data, buildDeps(c.env));

        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        return handleServiceError(c, error);
    }
});

upload.get('/:teamId/:documentType', async (c) => {
    try {
        const teamId = c.req.param('teamId');
        const documentType = c.req.param('documentType');
        const path = c.req.path;

        logInfo('upload.GET', `Raw request - path=${path}, teamId=${teamId}, documentType=${documentType}`);
        logInfo('upload.GET', `All params:`, c.req.param());

        const parseResult = getDocumentSchema.safeParse({ teamId, documentType });

        if (!parseResult.success) {
            logError('upload.GET', 'Validation error:', z.flattenError(parseResult.error).fieldErrors);
            return c.json(
                {
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid request parameters',
                        details: z.flattenError(parseResult.error).fieldErrors,
                    },
                },
                400,
            );
        }

        // --- IDOR PROTECTION: Verify the user owns the team ---
        const user = c.get('user');
        logInfo('upload.GET', `User auth check - user.id=${user?.id}, teamId=${parseResult.data.teamId}`);
        
        if (!user || user.id !== parseResult.data.teamId) {
            logError('upload.GET', 'IDOR Protection triggered - unauthorized access attempt');
            return c.json(
                {
                    success: false,
                    error: { code: 'FORBIDDEN', message: 'You can only access documents for your own team' },
                },
                403,
            );
        }
        // ----------------------------------------------------------

        logInfo('upload.GET', 'Auth passed, calling getDocument service');
        const result = await getDocument(parseResult.data, buildDeps(c.env));

        logInfo('upload.GET', 'Success - returning response');
        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        logError('upload.GET', 'Error caught:', error);
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
    INCOMPLETE_TEAM_INFO: 400,
    INCOMPLETE_DOCUMENTS: 422,
};

function handleServiceError(c: Context<{ Bindings: Env; Variables: { user: { id: string } } }>, error: unknown) {
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
