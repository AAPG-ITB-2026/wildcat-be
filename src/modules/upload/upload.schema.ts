import { z } from 'zod';

export const ALLOWED_CONTENT_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
] as const;

export const DOCUMENT_TYPES = ['ktm', 'instagram_follow', 'twibbon'] as const;


const teamIdField = z
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



export const confirmUploadSchema = z
    .object({
        teamId: teamIdField,
        documentType: documentTypeField,
        filePath: z
            .string()
            .min(1, 'filePath is required'),
    })
    .superRefine(({ teamId, documentType, filePath }, ctx) => {
        const expectedPrefix = `${teamId}/${documentType}/`;
        if (!filePath.startsWith(expectedPrefix)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['filePath'],
                message: `filePath must start with "${expectedPrefix}"`,
            });
        }
        if (filePath.startsWith('/') || filePath.includes('..')) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['filePath'],
                message: 'filePath must not contain path traversal segments',
            });
        }
    });

export type SignUploadInput = z.infer<typeof signUploadSchema>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
