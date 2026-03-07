import { z } from 'zod';

export const stageSubmissionsParamsSchema = z.object({
    stage_id: z.string().uuid('stage_id must be a valid UUID'),
});

export const adminReviewPaginationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});

// -----------------------------------------------------------------------------
// API Documentation Contracts (Zod-first)
// These schemas are kept close to runtime validation so they can be used by
// OpenAPI generators later (e.g. zod-to-openapi, hono-openapi adapters, etc).
// -----------------------------------------------------------------------------

const reviewStatusSchema = z.enum(['Pending', 'Verified', 'Rejected']);

const teamSummarySchema = z.object({
    id: z.string().uuid().describe('Team unique identifier'),
    name: z.string().describe('Team display name'),
    institution: z.string().describe('Team institution name'),
});

const signedFileViewSchema = z.object({
    originalFileRef: z.string().nullable().describe('Raw file reference stored in database'),
    objectKey: z.string().nullable().describe('Resolved and sanitized R2 object key'),
    downloadUrl: z
        .string()
        .url()
        .nullable()
        .describe('Temporary signed download URL, null when unavailable'),
});

const reviewErrorBodySchema = z.object({
    success: z.literal(false),
    error: z.object({
        code: z.enum(['VALIDATION_ERROR', 'INTERNAL_ERROR']),
        message: z.string(),
        details: z.record(z.string(), z.array(z.string())).optional(),
    }),
});

const transactionReviewItemSchema = z.object({
    transactionId: z.string().uuid().describe('Transaction ID'),
    team: teamSummarySchema,
    orderId: z.string().describe('Payment provider order ID'),
    amount: z.string().describe('Transaction amount as decimal string'),
    paymentType: z.string().describe('Payment method type'),
    verificationStatus: reviewStatusSchema,
    verifiedBy: z.string().nullable().describe('Committee account ID that verified the payment'),
    rejectionNotes: z.string().nullable().describe('Rejection reason if transaction is rejected'),
    createdAt: z.string().datetime().describe('Transaction creation timestamp in ISO-8601'),
    paymentProof: signedFileViewSchema,
});

const administrationReviewItemSchema = z.object({
    team: teamSummarySchema,
    verificationStatus: reviewStatusSchema,
    verifiedBy: z.string().nullable().describe('Committee account ID that verified administration docs'),
    rejectionNotes: z.string().nullable().describe('Rejection reason for administration verification'),
    documents: z.object({
        leadKtm: signedFileViewSchema,
        twibbonProof: signedFileViewSchema,
        posterProof: signedFileViewSchema,
    }),
});

const stageSubmissionReviewItemSchema = z.object({
    submissionId: z.string().uuid().describe('Submission ID'),
    team: teamSummarySchema,
    requirement: z.object({
        id: z.string().uuid().describe('Stage requirement ID'),
        documentName: z.string().describe('Requirement display name'),
    }),
    isValid: z.boolean().describe('Current submission validity status from review process'),
    verifiedBy: z.string().nullable().describe('Committee account ID that reviewed the submission'),
    submittedAt: z.string().datetime().describe('Submission timestamp in ISO-8601'),
    file: signedFileViewSchema,
});

export const transactionsReviewSuccessBodySchema = z.object({
    success: z.literal(true),
    data: z.array(transactionReviewItemSchema),
});

export const administrationReviewSuccessBodySchema = z.object({
    success: z.literal(true),
    data: z.array(administrationReviewItemSchema),
});

export const stageSubmissionsReviewSuccessBodySchema = z.object({
    success: z.literal(true),
    data: z.array(stageSubmissionReviewItemSchema),
});

export const adminReviewErrorBodySchema = reviewErrorBodySchema;

// A neutral endpoint descriptor shape that can be mapped into OpenAPI later.
export const adminReviewApiDocs = {
    transactions: {
        method: 'GET',
        path: '/api/admin/transactions',
        summary: 'List payment verification reviews for committee',
        request: {
            query: adminReviewPaginationQuerySchema,
        },
        responses: {
            200: transactionsReviewSuccessBodySchema,
            400: adminReviewErrorBodySchema,
            500: adminReviewErrorBodySchema,
        },
    },
    administration: {
        method: 'GET',
        path: '/api/admin/teams/administration',
        summary: 'List administration document reviews for committee',
        request: {
            query: adminReviewPaginationQuerySchema,
        },
        responses: {
            200: administrationReviewSuccessBodySchema,
            400: adminReviewErrorBodySchema,
            500: adminReviewErrorBodySchema,
        },
    },
    stageSubmissions: {
        method: 'GET',
        path: '/api/admin/stages/:stage_id/submissions',
        summary: 'List stage submission reviews by stage ID',
        request: {
            params: stageSubmissionsParamsSchema,
            query: adminReviewPaginationQuerySchema,
        },
        responses: {
            200: stageSubmissionsReviewSuccessBodySchema,
            400: adminReviewErrorBodySchema,
            500: adminReviewErrorBodySchema,
        },
    },
} as const;

export type TransactionsReviewSuccessBody = z.infer<typeof transactionsReviewSuccessBodySchema>;
export type AdministrationReviewSuccessBody = z.infer<typeof administrationReviewSuccessBodySchema>;
export type StageSubmissionsReviewSuccessBody = z.infer<typeof stageSubmissionsReviewSuccessBodySchema>;
export type AdminReviewErrorBody = z.infer<typeof adminReviewErrorBodySchema>;
