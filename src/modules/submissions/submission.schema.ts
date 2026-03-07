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
    file_path: z
        .string()
        .min(1, 'file_path is required'),
    requirement_id: z
        .string()
        .uuid('requirement_id must be a valid UUID'),
});

export type RequestUrlInput = z.infer<typeof requestUrlSchema>;
export type SaveSubmissionInput = z.infer<typeof saveSubmissionSchema>;
