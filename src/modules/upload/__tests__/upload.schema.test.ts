import { describe, it, expect } from 'vitest';

import {
    signUploadSchema,
    confirmUploadSchema,
    ALLOWED_CONTENT_TYPES,
    DOCUMENT_TYPES,
} from '../upload.schema.js';

describe('signUploadSchema', () => {
    const validBody = {
        teamId: '550e8400-e29b-41d4-a716-446655440000',
        documentType: 'ktm',
        contentType: 'image/jpeg',
        fileName: 'my_ktm.jpg',
    };

    it('should accept a valid request body', () => {
        const result = signUploadSchema.safeParse(validBody);
        expect(result.success).toBe(true);
    });

    it('should reject when teamId is not a valid UUID', () => {
        const result = signUploadSchema.safeParse({ ...validBody, teamId: 'not-a-uuid' });
        expect(result.success).toBe(false);
    });

    it('should reject when teamId is missing', () => {
        const { teamId, ...bodyWithoutTeamId } = validBody;
        const result = signUploadSchema.safeParse(bodyWithoutTeamId);
        expect(result.success).toBe(false);
    });

    it('should reject an unsupported contentType', () => {
        const result = signUploadSchema.safeParse({
            ...validBody,
            contentType: 'application/zip',
        });
        expect(result.success).toBe(false);
    });

    it('should accept every allowed contentType', () => {
        for (const ct of ALLOWED_CONTENT_TYPES) {
            const ext = ct === 'application/pdf' ? 'pdf' : ct.split('/')[1];
            const result = signUploadSchema.safeParse({
                ...validBody,
                contentType: ct,
                fileName: `file.${ext}`,
            });
            expect(result.success).toBe(true);
        }
    });

    it('should reject an invalid documentType', () => {
        const result = signUploadSchema.safeParse({
            ...validBody,
            documentType: 'passport',
        });
        expect(result.success).toBe(false);
    });

    it('should reject a fileName without a valid extension', () => {
        const result = signUploadSchema.safeParse({
            ...validBody,
            fileName: 'document.exe',
        });
        expect(result.success).toBe(false);
    });

    it('should reject an empty fileName', () => {
        const result = signUploadSchema.safeParse({
            ...validBody,
            fileName: '',
        });
        expect(result.success).toBe(false);
    });
});

describe('confirmUploadSchema', () => {
    const validBody = {
        teamId: '550e8400-e29b-41d4-a716-446655440000',
        documentType: 'ktm',
        filePath: '550e8400-e29b-41d4-a716-446655440000/ktm/1708300000000_ktm.jpg',
    };

    it('should accept a valid request body', () => {
        const result = confirmUploadSchema.safeParse(validBody);
        expect(result.success).toBe(true);
    });

    it('should reject when filePath is empty', () => {
        const result = confirmUploadSchema.safeParse({ ...validBody, filePath: '' });
        expect(result.success).toBe(false);
    });

    it('should reject an invalid documentType', () => {
        const result = confirmUploadSchema.safeParse({
            ...validBody,
            documentType: 'invalid_type',
        });
        expect(result.success).toBe(false);
    });

    it('should accept every valid documentType', () => {
        for (const dt of DOCUMENT_TYPES) {
            const result = confirmUploadSchema.safeParse({ ...validBody, documentType: dt });
            expect(result.success).toBe(true);
        }
    });

    it('should reject when teamId is missing', () => {
        const { teamId, ...bodyWithoutTeamId } = validBody;
        const result = confirmUploadSchema.safeParse(bodyWithoutTeamId);
        expect(result.success).toBe(false);
    });
});
