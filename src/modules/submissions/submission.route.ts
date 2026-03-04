import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { requestUrlSchema, saveSubmissionSchema } from './submission.schema.js';
import { requestPresignedUrl, saveSubmission } from './submission.service.js';
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

const ERROR_STATUS_MAP: Record<string, number> = {
    TEAM_NOT_FOUND: 404,
    NOT_VERIFIED: 403,
    INVALID_REQUIREMENT: 400,
    SIGNED_URL_FAILED: 502,
    DB_WRITE_FAILED: 500,
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
