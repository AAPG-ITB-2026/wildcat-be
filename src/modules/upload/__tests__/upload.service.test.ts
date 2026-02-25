import { describe, it, expect, vi } from 'vitest';

import {
    buildStoragePath,
    sanitizeFileName,
    generateSignedUploadUrl,
    confirmDocumentUpload,
} from '../upload.service.js';
import { UploadError } from '../upload.errors.js';
import type { UploadServiceDeps } from '../upload.types.js';

function createMockDeps(overrides?: Partial<UploadServiceDeps>): UploadServiceDeps {
    return {
        storage: {
            createSignedUploadUrl: vi.fn().mockResolvedValue({
                data: { signedUrl: 'https://supabase.co/signed-url', path: 'test-path' },
                error: null,
            }),
            listFiles: vi.fn().mockResolvedValue({
                data: [{ name: 'file.jpg' }],
                error: null,
            }),
            headFile: vi.fn().mockResolvedValue({
                data: { contentType: 'image/jpeg', contentLength: 12345 },
                error: null,
            }),
            getPublicUrl: vi.fn().mockReturnValue('https://placeholder/public/file.jpg'),
        },
        documents: {
            insert: vi.fn().mockResolvedValue({
                id: 'test-doc-id',
                teamId: 'test-team-id',
                fileUrl: 'https://placeholder/file.jpg',
                isVerified: false,
                createdAt: new Date(),
            }),
        },
        teams: {
            findById: vi.fn().mockResolvedValue({ id: 'test-team-id' }),
        },
        ...overrides,
    };
}

describe('buildStoragePath', () => {
    it('should produce a path in the format: {teamId}/{docType}/{timestamp}_{fileName}', () => {
        const teamId = '550e8400-e29b-41d4-a716-446655440000';
        const docType = 'ktm';
        const fileName = 'My KTM Card.jpg';

        const path = buildStoragePath(teamId, docType, fileName);

        expect(path).toMatch(
            /^550e8400-e29b-41d4-a716-446655440000\/ktm\/\d+_my-ktm-card\.jpg$/,
        );
    });

    it('should sanitize the file name within the path', () => {
        const path = buildStoragePath('team-id', 'ktm', 'Spaced File (1).PNG');
        expect(path).toContain('spaced-file-1.png');
    });
});

describe('sanitizeFileName', () => {
    it('should lowercase the file name', () => {
        expect(sanitizeFileName('MyFile.JPG')).toBe('myfile.jpg');
    });

    it('should replace spaces with hyphens', () => {
        expect(sanitizeFileName('my file name.pdf')).toBe('my-file-name.pdf');
    });

    it('should strip special characters', () => {
        expect(sanitizeFileName('file@#$%.jpg')).toBe('file.jpg');
    });

    it('should keep underscores and hyphens', () => {
        expect(sanitizeFileName('my_file-name.png')).toBe('my_file-name.png');
    });

    it('should handle multiple consecutive spaces', () => {
        expect(sanitizeFileName('a   b.jpg')).toBe('a-b.jpg');
    });

    it('should collapse multiple consecutive dots', () => {
        expect(sanitizeFileName('file..name..jpg')).toBe('file.name.jpg');
    });
});

describe('UploadError', () => {
    it('should carry both code and message', () => {
        const err = new UploadError('TEAM_NOT_FOUND', 'Team abc not found');
        expect(err.code).toBe('TEAM_NOT_FOUND');
        expect(err.message).toBe('Team abc not found');
        expect(err.name).toBe('UploadError');
    });

    it('should be an instance of Error', () => {
        const err = new UploadError('FILE_NOT_FOUND', 'missing');
        expect(err).toBeInstanceOf(Error);
    });
});

describe('generateSignedUploadUrl', () => {
    it('should return a signed URL for a valid team and input', async () => {
        const deps = createMockDeps();

        const input = {
            teamId: 'team-1',
            documentType: 'ktm' as const,
            contentType: 'image/jpeg' as const,
            fileName: 'ktm.jpg',
        };

        const result = await generateSignedUploadUrl(input, deps);

        expect(result.signedUrl).toBeDefined();
        expect(result.path).toBeDefined();
    });

    it('should throw TEAM_NOT_FOUND when team does not exist', async () => {
        const deps = createMockDeps({
            teams: { findById: vi.fn().mockResolvedValue(null) },
        });

        const input = {
            teamId: 'nonexistent',
            documentType: 'ktm' as const,
            contentType: 'image/jpeg' as const,
            fileName: 'ktm.jpg',
        };

        await expect(generateSignedUploadUrl(input, deps)).rejects.toThrow(UploadError);
    });

    it('should throw SIGNED_URL_FAILED when storage returns an error', async () => {
        const deps = createMockDeps({
            storage: {
                createSignedUploadUrl: vi.fn().mockResolvedValue({
                    data: null,
                    error: new Error('R2 connection failed'),
                }),
                listFiles: vi.fn(),
                headFile: vi.fn(),
                getPublicUrl: vi.fn(),
            },
        });

        const input = {
            teamId: 'team-1',
            documentType: 'ktm' as const,
            contentType: 'image/jpeg' as const,
            fileName: 'ktm.jpg',
        };

        await expect(generateSignedUploadUrl(input, deps)).rejects.toThrow(UploadError);
    });
});

describe('confirmDocumentUpload', () => {
    it('should insert document record for valid input', async () => {
        const deps = createMockDeps();

        const input = {
            teamId: 'team-1',
            documentType: 'ktm' as const,
            filePath: 'team-1/ktm/123_ktm.jpg',
        };

        const result = await confirmDocumentUpload(input, deps);

        expect(result.document.id).toBeDefined();
        expect(result.document.fileUrl).toContain('file.jpg');
    });

    it('should throw TEAM_NOT_FOUND when team does not exist', async () => {
        const deps = createMockDeps({
            teams: { findById: vi.fn().mockResolvedValue(null) },
        });

        const input = {
            teamId: 'nonexistent',
            documentType: 'ktm' as const,
            filePath: 'nonexistent/ktm/123_ktm.jpg',
        };

        await expect(confirmDocumentUpload(input, deps)).rejects.toThrow(UploadError);
    });

    it('should throw INVALID_FILE_PATH when filePath does not match expected prefix', async () => {
        const deps = createMockDeps();

        const input = {
            teamId: 'team-1',
            documentType: 'ktm' as const,
            filePath: 'other-team/instagram_follow/123_ktm.jpg',
        };

        await expect(confirmDocumentUpload(input, deps)).rejects.toThrow(UploadError);

        try {
            await confirmDocumentUpload(input, deps);
        } catch (err) {
            expect(err).toBeInstanceOf(UploadError);
            expect((err as UploadError).code).toBe('INVALID_FILE_PATH');
        }
    });

    it('should throw FILE_NOT_FOUND when headFile returns error', async () => {
        const deps = createMockDeps({
            storage: {
                createSignedUploadUrl: vi.fn(),
                listFiles: vi.fn(),
                headFile: vi.fn().mockResolvedValue({ data: null, error: new Error('NotFound') }),
                getPublicUrl: vi.fn(),
            },
        });

        const input = {
            teamId: 'team-1',
            documentType: 'ktm' as const,
            filePath: 'team-1/ktm/123_ktm.jpg',
        };

        await expect(confirmDocumentUpload(input, deps)).rejects.toThrow(UploadError);
    });

    it('should throw INVALID_CONTENT_TYPE when file has disallowed content-type', async () => {
        const deps = createMockDeps({
            storage: {
                createSignedUploadUrl: vi.fn(),
                listFiles: vi.fn(),
                headFile: vi.fn().mockResolvedValue({
                    data: { contentType: 'text/html', contentLength: 500 },
                    error: null,
                }),
                getPublicUrl: vi.fn(),
            },
        });

        const input = {
            teamId: 'team-1',
            documentType: 'ktm' as const,
            filePath: 'team-1/ktm/123_evil.html',
        };

        await expect(confirmDocumentUpload(input, deps)).rejects.toThrow(UploadError);

        try {
            await confirmDocumentUpload(input, deps);
        } catch (err) {
            expect(err).toBeInstanceOf(UploadError);
            expect((err as UploadError).code).toBe('INVALID_CONTENT_TYPE');
        }
    });
});
