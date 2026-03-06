import { describe, it, expect } from 'vitest';

import { requestUrlSchema, saveSubmissionSchema } from '../submission.schema.js';

describe('requestUrlSchema', () => {
    const validBody = {
        filename: 'paper.pdf',
        requirement_id: '550e8400-e29b-41d4-a716-446655440000',
    };

    it('should accept a valid request body', () => {
        const result = requestUrlSchema.safeParse(validBody);
        expect(result.success).toBe(true);
    });

    it('should reject when filename is empty', () => {
        const result = requestUrlSchema.safeParse({ ...validBody, filename: '' });
        expect(result.success).toBe(false);
    });

    it('should reject when filename exceeds 255 characters', () => {
        const result = requestUrlSchema.safeParse({
            ...validBody,
            filename: 'a'.repeat(256),
        });
        expect(result.success).toBe(false);
    });

    it('should reject when requirement_id is not a valid UUID', () => {
        const result = requestUrlSchema.safeParse({
            ...validBody,
            requirement_id: 'not-a-uuid',
        });
        expect(result.success).toBe(false);
    });

    it('should reject when requirement_id is missing', () => {
        const { requirement_id, ...bodyWithoutReqId } = validBody;
        const result = requestUrlSchema.safeParse(bodyWithoutReqId);
        expect(result.success).toBe(false);
    });

    it('should reject when filename is missing', () => {
        const { filename, ...bodyWithoutFilename } = validBody;
        const result = requestUrlSchema.safeParse(bodyWithoutFilename);
        expect(result.success).toBe(false);
    });
});

describe('saveSubmissionSchema', () => {
    const validBody = {
        file_path: 'submissions/team-1/req-1/123_paper.pdf',
        requirement_id: '550e8400-e29b-41d4-a716-446655440000',
    };

    it('should accept a valid request body', () => {
        const result = saveSubmissionSchema.safeParse(validBody);
        expect(result.success).toBe(true);
    });

    it('should accept a non-URL storage path', () => {
        const result = saveSubmissionSchema.safeParse({
            ...validBody,
            file_path: 'relative/path/file.pdf',
        });
        expect(result.success).toBe(true);
    });

    it('should reject when file_path is empty', () => {
        const result = saveSubmissionSchema.safeParse({
            ...validBody,
            file_path: '',
        });
        expect(result.success).toBe(false);
    });

    it('should reject when requirement_id is not a valid UUID', () => {
        const result = saveSubmissionSchema.safeParse({
            ...validBody,
            requirement_id: 'invalid',
        });
        expect(result.success).toBe(false);
    });

    it('should reject when requirement_id is missing', () => {
        const { requirement_id, ...bodyWithoutReqId } = validBody;
        const result = saveSubmissionSchema.safeParse(bodyWithoutReqId);
        expect(result.success).toBe(false);
    });

    it('should reject when file_path is missing', () => {
        const { file_path, ...bodyWithoutPath } = validBody;
        const result = saveSubmissionSchema.safeParse(bodyWithoutPath);
        expect(result.success).toBe(false);
    });
});
