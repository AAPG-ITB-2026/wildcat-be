import { z } from 'zod';

export const PAYMENT_ALLOWED_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'application/pdf',
] as const;

// Step 1: Presigned URL Generation
export const requestPaymentUrlSchema = z.object({
    fileName: z
        .string()
        .min(1, 'fileName is required')
        .max(255, 'fileName too long')
        .refine(
            (name) => /\.(jpg|jpeg|png|pdf)$/i.test(name),
            'fileName must end with a valid extension (.jpg, .jpeg, .png, .pdf)',
        ),
    contentType: z.enum(PAYMENT_ALLOWED_CONTENT_TYPES, {
        error: () => ({
            message: `contentType must be one of: ${PAYMENT_ALLOWED_CONTENT_TYPES.join(', ')}`,
        }),
    }),
});

// Step 2: Submit Payment Proof
export const submitPaymentProofSchema = z.object({
    file_url: z.string().min(1, 'file_url is required'),
    payment_method: z.string().min(1, 'payment_method is required'),
});

export type RequestPaymentUrlInput = z.infer<typeof requestPaymentUrlSchema>;
export type SubmitPaymentProofInput = z.infer<typeof submitPaymentProofSchema>;
