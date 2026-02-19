import { version } from 'os';
import { z } from 'zod';

export const documentTypeSchema = z.enum(['ktm', 'instagram_follow', 'twibbon']);

export const contentTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export const signUploadSchema = z.object({
  teamId: z.uuid(),
  fileName: z.string().min(1),
  contentType: contentTypeSchema,
  documentType: documentTypeSchema,
});

export const confirmUploadSchema = z.object({
  teamId: z.uuid(),
  filePath: z.string().min(1),
  documentType: documentTypeSchema,
});

export type SignUploadInput = z.infer<typeof signUploadSchema>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
