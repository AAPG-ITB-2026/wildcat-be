import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { requestUrlSchema, saveSubmissionSchema, getSubmissionSchema } from './submission.schema.js';
import { requestPresignedUrl, saveSubmission, getSubmission } from './submission.service.js';
import { SubmissionError } from './submission.errors.js';
import type { SubmissionServiceDeps } from './submission.types.js';
import { createDrizzleGatekeepingRepo } from './adapters/drizzle-gatekeeping.adapter.js';
import { createDrizzleSubmissionRepo } from './adapters/drizzle-submission.adapter.js';
import { createDrizzleSubmissionTeamRepo } from './adapters/drizzle-submission-team.adapter.js';
import { createDb } from '../../db/index.js';
import { getStorage } from '../../lib/r2.js';
import type { Env, Variables } from '../../types/index.js';

const submissions = new Hono<{ Bindings: Env; Variables: Variables }>();

function buildDeps(env: Env): SubmissionServiceDeps {
    const db = createDb(env);
    return {
        storage: getStorage(env),
        gatekeeping: createDrizzleGatekeepingRepo(db),
        submissions: createDrizzleSubmissionRepo(db),
        teams: createDrizzleSubmissionTeamRepo(db),
    };
}

submissions.post('/request-url', async (c) => {
    try {
        const user = c.get('user');
        const teamId = user.id;

        const body = await c.req.json();
        const parseResult = requestUrlSchema.safeParse(body);

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

        const result = await requestPresignedUrl(teamId, parseResult.data, buildDeps(c.env));

        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        return handleServiceError(c, error);
    }
});

submissions.post('/', async (c) => {
    try {
        const user = c.get('user');
        const teamId = user.id;

        const body = await c.req.json();
        const parseResult = saveSubmissionSchema.safeParse(body);

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

        const result = await saveSubmission(teamId, parseResult.data, buildDeps(c.env));

        return c.json({ success: true, data: result }, 201);
    } catch (error) {
        return handleServiceError(c, error);
    }
});

submissions.get('/:requirementId', async (c) => {
    try {
        const user = c.get('user');
        const teamId = user.id;
        const requirementId = c.req.param('requirementId');

        console.log(`[submission.GET] Request: GET /:${requirementId}, teamId=${teamId}`);

        const parseResult = getSubmissionSchema.safeParse({ requirement_id: requirementId });

        if (!parseResult.success) {
            console.log(`[submission.GET] Validation error:`, z.flattenError(parseResult.error).fieldErrors);
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

        console.log(`[submission.GET] Auth passed (user.id=${teamId}), calling getSubmission service`);
        const result = await getSubmission(teamId, parseResult.data, buildDeps(c.env));

        console.log(`[submission.GET] Success - returning response`);
        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        console.log(`[submission.GET] Error caught:`, error);
        return handleServiceError(c, error);
    }
});

const ERROR_STATUS_MAP: Record<string, number> = {
    TEAM_NOT_FOUND: 404,
    NOT_VERIFIED: 403,
    STAGE_NOT_ASSIGNED: 400,
    REQUIREMENT_NOT_FOUND: 400,
    STAGE_MISMATCH: 400,
    INVALID_EXTENSION: 400,
    INVALID_CONTENT_TYPE: 422,
    INVALID_STORAGE_PATH: 400,
    FILE_METADATA_UNAVAILABLE: 400,
    FILE_TOO_LARGE: 400,
    SIGNED_URL_FAILED: 502,
    DB_WRITE_FAILED: 500,
    SUBMISSION_NOT_FOUND: 404,
    FILE_NOT_FOUND: 404,
};

function handleServiceError(c: Context<{ Bindings: Env; Variables: Variables }>, error: unknown) {
    if (error instanceof SubmissionError) {
        const status = (ERROR_STATUS_MAP[error.code] ?? 500) as ContentfulStatusCode;
        return c.json(
            {
                success: false,
                error: { code: error.code, message: error.message },
            },
            status,
        );
    }

    console.error('[submissions] Unexpected error:', error);
    return c.json(
        {
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        },
        500,
    );
}

export default submissions;
