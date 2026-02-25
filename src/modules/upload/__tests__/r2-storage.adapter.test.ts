import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend, mockGetSignedUrl } = vi.hoisted(() => ({
    mockSend: vi.fn(),
    mockGetSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => {
    return {
        S3Client: class MockS3Client {
            send = mockSend;
        },
        PutObjectCommand: class MockPutObjectCommand {
            input: unknown;
            constructor(input: unknown) { this.input = input; }
        },
        ListObjectsV2Command: class MockListObjectsV2Command {
            input: unknown;
            constructor(input: unknown) { this.input = input; }
        },
        HeadObjectCommand: class MockHeadObjectCommand {
            input: unknown;
            constructor(input: unknown) { this.input = input; }
        },
    };
});

vi.mock('@aws-sdk/s3-request-presigner', () => {
    return {
        getSignedUrl: mockGetSignedUrl,
    };
});

import { createR2Storage } from '../adapters/r2-storage.adapter.js';
import type { R2StorageConfig } from '../adapters/r2-storage.adapter.js';

const baseConfig: R2StorageConfig = {
    accountId: 'test-account-id',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
    bucketName: 'documents',
    publicUrl: 'https://cdn.example.com',
    signedUrlExpiresIn: 600,
};

function createStorage(overrides?: Partial<R2StorageConfig>) {
    return createR2Storage({ ...baseConfig, ...overrides });
}

describe('R2 Storage Adapter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createSignedUploadUrl', () => {
        it('should return a signed URL and path on success', async () => {
            const fakeUrl = 'https://test-account-id.r2.cloudflarestorage.com/signed?X-Amz-Signature=abc';
            mockGetSignedUrl.mockResolvedValue(fakeUrl);

            const storage = createStorage();
            const result = await storage.createSignedUploadUrl('team/ktm/123_file.jpg', {
                contentType: 'image/jpeg',
            });

            expect(result.error).toBeNull();
            expect(result.data).not.toBeNull();
            expect(result.data!.signedUrl).toBe(fakeUrl);
            expect(result.data!.path).toBe('team/ktm/123_file.jpg');
        });

        it('should return an error result when getSignedUrl throws', async () => {
            mockGetSignedUrl.mockRejectedValue(new Error('Network failure'));

            const storage = createStorage();
            const result = await storage.createSignedUploadUrl('team/ktm/123_file.jpg');

            expect(result.data).toBeNull();
            expect(result.error).toBeInstanceOf(Error);
            expect(result.error!.message).toBe('Network failure');
        });

        it('should call getSignedUrl with the configured expiresIn', async () => {
            mockGetSignedUrl.mockResolvedValue('https://signed.url');

            const storage = createStorage({ signedUrlExpiresIn: 120 });
            await storage.createSignedUploadUrl('path/file.pdf');

            expect(mockGetSignedUrl).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything(),
                expect.objectContaining({ expiresIn: 120 }),
            );
        });
    });


    describe('listFiles', () => {
        it('should return mapped file list from S3 response', async () => {
            mockSend.mockResolvedValue({
                Contents: [
                    { Key: 'team/ktm/123_file.jpg' },
                    { Key: 'team/ktm/456_file.png' },
                ],
            });

            const storage = createStorage();
            const result = await storage.listFiles('team/ktm', '123_file.jpg');

            expect(result.error).toBeNull();
            expect(result.data).toEqual([
                { name: '123_file.jpg' },
                { name: '456_file.png' },
            ]);
        });

        it('should return empty array when no Contents', async () => {
            mockSend.mockResolvedValue({ Contents: undefined });

            const storage = createStorage();
            const result = await storage.listFiles('team/ktm');

            expect(result.error).toBeNull();
            expect(result.data).toEqual([]);
        });

        it('should return error result when S3 throws', async () => {
            mockSend.mockRejectedValue(new Error('Access Denied'));

            const storage = createStorage();
            const result = await storage.listFiles('team/ktm');

            expect(result.data).toBeNull();
            expect(result.error).toBeInstanceOf(Error);
            expect(result.error!.message).toBe('Access Denied');
        });

        it('should use folder/ prefix when no search provided', async () => {
            mockSend.mockResolvedValue({ Contents: [] });

            const storage = createStorage();
            await storage.listFiles('team/ktm');

            expect(mockSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: expect.objectContaining({ Prefix: 'team/ktm/' }),
                }),
            );
        });

        it('should use folder/search prefix when search provided', async () => {
            mockSend.mockResolvedValue({ Contents: [] });

            const storage = createStorage();
            await storage.listFiles('team/ktm', '123_file');

            expect(mockSend).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: expect.objectContaining({ Prefix: 'team/ktm/123_file' }),
                }),
            );
        });
    });


    describe('getPublicUrl', () => {
        it('should return publicUrl/path', () => {
            const storage = createStorage();
            const url = storage.getPublicUrl('team/ktm/123_file.jpg');
            expect(url).toBe('https://cdn.example.com/team/ktm/123_file.jpg');
        });

        it('should strip trailing slashes from publicUrl', () => {
            const storage = createStorage({ publicUrl: 'https://cdn.example.com///' });
            const url = storage.getPublicUrl('file.jpg');
            expect(url).toBe('https://cdn.example.com/file.jpg');
        });
    });
});


describe('headFile', () => {
    it('should return content-type and content-length on success', async () => {
        mockSend.mockResolvedValue({
            ContentType: 'image/jpeg',
            ContentLength: 12345,
        });

        const storage = createStorage();
        const result = await storage.headFile('team/ktm/123_file.jpg');

        expect(result.error).toBeNull();
        expect(result.data).toEqual({
            contentType: 'image/jpeg',
            contentLength: 12345,
        });
    });

    it('should return error when file does not exist', async () => {
        mockSend.mockRejectedValue(new Error('NotFound'));

        const storage = createStorage();
        const result = await storage.headFile('team/ktm/nonexistent.jpg');

        expect(result.data).toBeNull();
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error!.message).toBe('NotFound');
    });

    it('should default contentType to application/octet-stream when missing', async () => {
        mockSend.mockResolvedValue({
            ContentType: undefined,
            ContentLength: 0,
        });

        const storage = createStorage();
        const result = await storage.headFile('team/ktm/file.bin');

        expect(result.error).toBeNull();
        expect(result.data!.contentType).toBe('application/octet-stream');
    });
});

