import { z } from 'zod';

export const ALLOWED_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
] as const;

export const DOCUMENT_TYPES = [
    'lead_ktm',
    'm1_ktm',
    'm2_ktm',
    'twibbon_proof',
    'poster_proof',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const teamIdField = z
    .string()
    .uuid('teamId must be a valid UUID');

const documentTypeField = z.enum(DOCUMENT_TYPES, {
    error: () => ({ message: `documentType must be one of: ${DOCUMENT_TYPES.join(', ')}` }),
});


export const signUploadSchema = z.object({
    teamId: teamIdField,
    documentType: documentTypeField,
    contentType: z.enum(ALLOWED_CONTENT_TYPES, {
        error: () => ({
            message: `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
        }),
    }),
    fileName: z
        .string()
        .min(1, 'fileName is required')
        .max(255, 'fileName too long')
        .refine(
            (name) => /\.(jpg|jpeg|png|webp|pdf)$/i.test(name),
            'fileName must end with a valid extension (.jpg, .jpeg, .png, .webp, .pdf)',
        ),
});



export const confirmUploadSchema = z.object({
    teamId: teamIdField,
    documentType: documentTypeField,
    filePath: z
        .string()
        .min(1, 'filePath is required'),
});

export type SignUploadInput = z.infer<typeof signUploadSchema>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
