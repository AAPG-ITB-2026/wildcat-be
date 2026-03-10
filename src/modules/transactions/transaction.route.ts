import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

import { requestPaymentUrlSchema, submitPaymentProofSchema } from './transaction.schema.js';
import { generatePaymentSignedUrl, submitPaymentProof } from './transaction.service.js';
import { TransactionError } from './transaction.errors.js';
import type { TransactionServiceDeps } from './transaction.types.js';
import {
    createDrizzleTransactionRepo,
    createDrizzleTeamCompetitionRepo,
} from './adapters/drizzle-transaction.adapter.js';
import { createDb } from '../../db/index.js';
import { getStorage } from '../../lib/r2.js';
import type { Env } from '../../types/index.js';

const transactionsRoute = new Hono<{ Bindings: Env; Variables: { user: { id: string } } }>();


const ERROR_STATUS_MAP: Record<string, number> = {
    TEAM_NOT_FOUND: 404,
    TRANSACTION_NOT_FOUND: 404,
    SIGNED_URL_FAILED: 502,
    FILE_NOT_FOUND: 404,
    INVALID_CONTENT_TYPE: 422,
    FILE_TOO_LARGE: 422,
    DB_WRITE_FAILED: 500,
};

function buildDeps(env: Env): TransactionServiceDeps {
    const db = createDb(env);
    return {
        storage: getStorage(env),
        transactions: createDrizzleTransactionRepo(db),
        teams: createDrizzleTeamCompetitionRepo(db),
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transactions/request-url
// Step 1: Generate a presigned PUT URL for the FE to upload a payment receipt.
// Security: Participant Auth (injected via authMiddleware in index.ts).
// ─────────────────────────────────────────────────────────────────────────────
transactionsRoute.post('/request-url', async (c) => {
    try {
        const body = await c.req.json();
        const parseResult = requestPaymentUrlSchema.safeParse(body);

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

        const user = c.get('user');
        const result = await generatePaymentSignedUrl(parseResult.data, user.id, buildDeps(c.env));

        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        return handleServiceError(c, error);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transactions/submit-proof
// Step 2: Submit the payment proof URL + payment method after upload.
// Security: Participant Auth.
// Payload: { file_url: string, payment_method: string }
// ─────────────────────────────────────────────────────────────────────────────
transactionsRoute.post('/submit-proof', async (c) => {
    try {
        const body = await c.req.json();
        const parseResult = submitPaymentProofSchema.safeParse(body);

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

        const user = c.get('user');
        const result = await submitPaymentProof(parseResult.data, user.id, buildDeps(c.env));

        return c.json({ success: true, data: result }, 200);
    } catch (error) {
        return handleServiceError(c, error);
    }
});

function handleServiceError(
    c: Context<{ Bindings: Env; Variables: { user: { id: string } } }>,
    error: unknown,
) {
    if (error instanceof TransactionError) {
        const status = (ERROR_STATUS_MAP[error.code] ?? 500) as ContentfulStatusCode;
        return c.json(
            {
                success: false,
                error: { code: error.code, message: error.message },
            },
            status,
        );
    }

    console.error('[transactions] Unexpected error:', error);
    return c.json(
        {
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        },
        500,
    );
}

export default transactionsRoute;
