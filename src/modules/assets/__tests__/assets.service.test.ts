import { describe, it, expect, vi } from 'vitest';

import {
    getRestrictedAsset,
    validateFileName,
    buildAssetPath,
} from '../assets.service.js';
import { AssetError } from '../assets.errors.js';
import type { AssetServiceDeps } from '../assets.types.js';

function createMockDeps(overrides?: Partial<AssetServiceDeps>): AssetServiceDeps {
    return {
        storage: {
            createSignedDownloadUrl: vi.fn().mockResolvedValue({
                data: { signedUrl: 'https://r2.example.com/signed-download' },
                error: null,
            }),
        },
        teams: {
            findByUserId: vi.fn().mockResolvedValue({
                id: 'test-team-id',
                status: 'Registered',
            }),
        },
        ...overrides,
    };
}

describe('validateFileName', () => {
    it('should accept a valid filename', () => {
        expect(() => validateFileName('guidebook-2026.pdf')).not.toThrow();
    });

    it('should accept filenames with underscores', () => {
        expect(() => validateFileName('template_v2.docx')).not.toThrow();
    });

    it('should reject empty filenames', () => {
        expect(() => validateFileName('')).toThrow(AssetError);
        try {
            validateFileName('');
        } catch (err) {
            expect((err as AssetError).code).toBe('INVALID_FILENAME');
        }
    });

    it('should reject filenames with path traversal (..)', () => {
        expect(() => validateFileName('../etc/passwd')).toThrow(AssetError);
        try {
            validateFileName('../etc/passwd');
        } catch (err) {
            expect((err as AssetError).code).toBe('INVALID_FILENAME');
        }
    });

    it('should reject filenames with forward slashes', () => {
        expect(() => validateFileName('path/to/file.pdf')).toThrow(AssetError);
    });

    it('should reject filenames with backslashes', () => {
        expect(() => validateFileName('path\\to\\file.pdf')).toThrow(AssetError);
    });

    it('should reject filenames with special characters', () => {
        expect(() => validateFileName('file@name.pdf')).toThrow(AssetError);
        expect(() => validateFileName('file name.pdf')).toThrow(AssetError);
        expect(() => validateFileName('file#1.pdf')).toThrow(AssetError);
    });
});

describe('buildAssetPath', () => {
    it('should prefix the filename with "assets/"', () => {
        expect(buildAssetPath('guidebook.pdf')).toBe('assets/guidebook.pdf');
    });
});

describe('getRestrictedAsset', () => {
    it('should return a signed URL for a valid registered user and valid file', async () => {
        const deps = createMockDeps();

        const result = await getRestrictedAsset('user-1', 'guidebook-2026.pdf', deps);

        expect(result).toEqual({
            signedUrl: 'https://r2.example.com/signed-download',
            fileName: 'guidebook-2026.pdf',
            expiresIn: 600,
        });
        expect(deps.storage.createSignedDownloadUrl).toHaveBeenCalledWith(
            'assets/guidebook-2026.pdf',
            600,
        );
    });

    it('should allow access for Document_Verified status', async () => {
        const deps = createMockDeps({
            teams: {
                findByUserId: vi.fn().mockResolvedValue({
                    id: 'team-2',
                    status: 'Document_Verified',
                }),
            },
        });

        const result = await getRestrictedAsset('user-2', 'template.zip', deps);
        expect(result.signedUrl).toBeDefined();
    });

    it('should allow access for Paid status', async () => {
        const deps = createMockDeps({
            teams: {
                findByUserId: vi.fn().mockResolvedValue({
                    id: 'team-3',
                    status: 'Paid',
                }),
            },
        });

        const result = await getRestrictedAsset('user-3', 'template.zip', deps);
        expect(result.signedUrl).toBeDefined();
    });

    it('should throw TEAM_NOT_FOUND when no team exists for the user', async () => {
        const deps = createMockDeps({
            teams: { findByUserId: vi.fn().mockResolvedValue(null) },
        });

        await expect(
            getRestrictedAsset('orphan-user', 'guidebook.pdf', deps),
        ).rejects.toThrow(AssetError);

        try {
            await getRestrictedAsset('orphan-user', 'guidebook.pdf', deps);
        } catch (err) {
            expect((err as AssetError).code).toBe('TEAM_NOT_FOUND');
        }
    });

    it('should throw NOT_REGISTERED when team status is not allowed', async () => {
        const deps = createMockDeps({
            teams: {
                findByUserId: vi.fn().mockResolvedValue({
                    id: 'team-4',
                    status: 'Pending',
                }),
            },
        });

        await expect(
            getRestrictedAsset('user-4', 'guidebook.pdf', deps),
        ).rejects.toThrow(AssetError);

        try {
            await getRestrictedAsset('user-4', 'guidebook.pdf', deps);
        } catch (err) {
            expect((err as AssetError).code).toBe('NOT_REGISTERED');
        }
    });

    it('should throw NOT_REGISTERED for empty status string', async () => {
        const deps = createMockDeps({
            teams: {
                findByUserId: vi.fn().mockResolvedValue({
                    id: 'team-5',
                    status: '',
                }),
            },
        });

        await expect(
            getRestrictedAsset('user-5', 'guidebook.pdf', deps),
        ).rejects.toThrow(AssetError);

        try {
            await getRestrictedAsset('user-5', 'guidebook.pdf', deps);
        } catch (err) {
            expect((err as AssetError).code).toBe('NOT_REGISTERED');
        }
    });

    it('should throw INVALID_FILENAME for path-traversal filenames', async () => {
        const deps = createMockDeps();

        await expect(
            getRestrictedAsset('user-1', '../etc/passwd', deps),
        ).rejects.toThrow(AssetError);

        try {
            await getRestrictedAsset('user-1', '../etc/passwd', deps);
        } catch (err) {
            expect((err as AssetError).code).toBe('INVALID_FILENAME');
        }
    });

    it('should throw INVALID_FILENAME for filenames with slashes', async () => {
        const deps = createMockDeps();

        await expect(
            getRestrictedAsset('user-1', 'subdir/secret.pdf', deps),
        ).rejects.toThrow(AssetError);
    });

    it('should throw SIGNED_URL_FAILED when storage returns a generic error', async () => {
        const deps = createMockDeps({
            storage: {
                createSignedDownloadUrl: vi.fn().mockResolvedValue({
                    data: null,
                    error: new Error('R2 connection timeout'),
                }),
            },
        });

        await expect(
            getRestrictedAsset('user-1', 'guidebook.pdf', deps),
        ).rejects.toThrow(AssetError);

        try {
            await getRestrictedAsset('user-1', 'guidebook.pdf', deps);
        } catch (err) {
            expect((err as AssetError).code).toBe('SIGNED_URL_FAILED');
        }
    });

    it('should throw ASSET_NOT_FOUND when storage error indicates missing file', async () => {
        const deps = createMockDeps({
            storage: {
                createSignedDownloadUrl: vi.fn().mockResolvedValue({
                    data: null,
                    error: new Error('NoSuchKey: The specified key does not exist'),
                }),
            },
        });

        await expect(
            getRestrictedAsset('user-1', 'missing-file.pdf', deps),
        ).rejects.toThrow(AssetError);

        try {
            await getRestrictedAsset('user-1', 'missing-file.pdf', deps);
        } catch (err) {
            expect((err as AssetError).code).toBe('ASSET_NOT_FOUND');
        }
    });

    it('should not call storage if filename validation fails', async () => {
        const deps = createMockDeps();

        await expect(
            getRestrictedAsset('user-1', '../bad-path', deps),
        ).rejects.toThrow();

        expect(deps.storage.createSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('should not call storage if team lookup fails', async () => {
        const deps = createMockDeps({
            teams: { findByUserId: vi.fn().mockResolvedValue(null) },
        });

        await expect(
            getRestrictedAsset('user-1', 'guidebook.pdf', deps),
        ).rejects.toThrow();

        expect(deps.storage.createSignedDownloadUrl).not.toHaveBeenCalled();
    });
});
