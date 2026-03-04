import { z } from 'zod';

export const requestUrlSchema = z.object({
    filename: z
        .string()
        .min(1, 'filename is required')
        .max(255, 'filename too long'),
    requirement_id: z
        .string()
        .uuid('requirement_id must be a valid UUID'),
});

export const saveSubmissionSchema = z.object({
    file_url: z
        .string()
        .url('file_url must be a valid URL'),
    requirement_id: z
        .string()
        .uuid('requirement_id must be a valid UUID'),
});

export type RequestUrlInput = z.infer<typeof requestUrlSchema>;
export type SaveSubmissionInput = z.infer<typeof saveSubmissionSchema>;
