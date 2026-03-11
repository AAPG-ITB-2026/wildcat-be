import { z } from 'zod';

export const PAYMENT_ALLOWED_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'application/pdf',
] as const;

// Step 1: Presigned URL Generation
export const requestPaymentUrlSchema = z.object({
    filename: z
        .string()
        .min(1, 'filename is required')
        .max(255, 'filename too long')
        .refine(
            (name) => /\.(jpg|jpeg|png|pdf)$/i.test(name),
            'filename must end with a valid extension (.jpg, .jpeg, .png, .pdf)',
        ),
    content_type: z.enum(PAYMENT_ALLOWED_CONTENT_TYPES, {
        error: () => ({
            message: `content_type must be one of: ${PAYMENT_ALLOWED_CONTENT_TYPES.join(', ')}`,
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
