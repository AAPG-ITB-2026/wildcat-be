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
        console.log('[transactions.request-url] Request body:', JSON.stringify(body));
        
        const parseResult = requestPaymentUrlSchema.safeParse(body);

        if (!parseResult.success) {
            console.log('[transactions.request-url] Validation error:', z.flattenError(parseResult.error).fieldErrors);
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
        
        console.log('[transactions.request-url] Generated result:', JSON.stringify(result));

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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transactions
// Retrieve the team's latest payment submission details.
// Security: Participant Auth.
//
// Description:
//   Allows participants to preview their current payment submission including
//   the proof URL, payment method, verification status, and timestamps.
//
// Response:
//   {
//     "success": true,
//     "data": {
//       "id": "uuid",
//       "teamId": "uuid",
//       "amount": "500000.00",
//       "paymentType": "Bank Transfer",
//       "paymentProofUrl": "wildcat2026/payments/...",
//       "verificationStatus": "Pending" | "Verified" | "Rejected",
//       "rejectionNotes": "string or null",
//       "createdAt": "2024-01-15T10:30:00Z"
//     }
//   }
//
// Error Responses:
//   - 404: Team or transaction not found
//   - 500: Database error
// ─────────────────────────────────────────────────────────────────────────────
transactionsRoute.get('/', async (c) => {
    try {
        const user = c.get('user');
        const db = createDb(c.env);
        const transactionRepo = createDrizzleTransactionRepo(db);
        const storage = getStorage(c.env);

        console.log('[transactions.get] Fetching transaction for team:', user.id);

        // Fetch the team's latest transaction
        const transaction = await transactionRepo.findByTeamId(user.id);

        if (!transaction) {
            console.log('[transactions.get] No transaction found for team:', user.id);
            return c.json(
                {
                    success: false,
                    error: { code: 'TRANSACTION_NOT_FOUND', message: 'No payment submission found' },
                },
                404,
            );
        }

        console.log('[transactions.get] Found transaction:', {
            id: transaction.id,
            paymentProofUrl: transaction.paymentProofUrl,
            verificationStatus: transaction.verificationStatus,
        });

        // Generate signed download URL if payment proof exists
        let signedProofUrl: string | null = null;
        if (transaction.paymentProofUrl) {
            try {
                const pathWithoutBucket = transaction.paymentProofUrl.startsWith('wildcat2026/')
                    ? transaction.paymentProofUrl.substring('wildcat2026/'.length)
                    : transaction.paymentProofUrl;

                console.log('[transactions.get] Creating signed URL for path:', pathWithoutBucket);

                const { data: url, error: urlError } = await storage.createSignedDownloadUrl(
                    pathWithoutBucket,
                    3600, // 1 hour
                );

                if (!urlError && url) {
                    signedProofUrl = url;
                    console.log('[transactions.get] Successfully created signed URL');
                } else {
                    console.log('[transactions.get] Failed to create signed URL:', urlError?.message);
                }
            } catch (error) {
                console.log('[transactions.get] Error creating signed URL:', error);
            }
        } else {
            console.log('[transactions.get] No paymentProofUrl in transaction');
        }

        return c.json(
            {
                success: true,
                data: {
                    id: transaction.id,
                    teamId: transaction.teamId,
                    amount: transaction.amount,
                    paymentType: transaction.paymentType,
                    paymentProofUrl: signedProofUrl, // Return signed URL, not raw path
                    verificationStatus: transaction.verificationStatus,
                    rejectionNotes: transaction.rejectionNotes,
                    createdAt: transaction.createdAt,
                },
            },
            200,
        );
    } catch (error) {
        console.error('[transactions.get] Error:', error);
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
