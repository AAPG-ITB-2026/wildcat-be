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

import { createR2Storage, loadR2ConfigFromEnv } from '../adapters/r2-storage.adapter.js';
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
        it('should return a signed URL, path, and token on success', async () => {
            const fakeUrl = 'https://test-account-id.r2.cloudflarestorage.com/signed?X-Amz-Signature=abc';
            mockGetSignedUrl.mockResolvedValue(fakeUrl);

            const storage = createStorage();
            const result = await storage.createSignedUploadUrl('team/ktm/123_file.jpg', {
                upsert: true,
                contentType: 'image/jpeg',
            });

            expect(result.error).toBeNull();
            expect(result.data).not.toBeNull();
            expect(result.data!.signedUrl).toBe(fakeUrl);
            expect(result.data!.path).toBe('team/ktm/123_file.jpg');
            expect(result.data!.token).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            );
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


describe('loadR2ConfigFromEnv', () => {
    it('should throw when required env vars are missing', () => {
        delete process.env.R2_ACCOUNT_ID;
        delete process.env.R2_ACCESS_KEY_ID;
        delete process.env.R2_SECRET_ACCESS_KEY;
        delete process.env.R2_BUCKET_NAME;
        delete process.env.R2_PUBLIC_URL;

        expect(() => loadR2ConfigFromEnv()).toThrow(/Missing required environment variables/);
    });

    it('should return config when all env vars are present', () => {
        process.env.R2_ACCOUNT_ID = 'acc-123';
        process.env.R2_ACCESS_KEY_ID = 'key-123';
        process.env.R2_SECRET_ACCESS_KEY = 'secret-123';
        process.env.R2_BUCKET_NAME = 'my-bucket';
        process.env.R2_PUBLIC_URL = 'https://cdn.test.com';

        const config = loadR2ConfigFromEnv();

        expect(config.accountId).toBe('acc-123');
        expect(config.accessKeyId).toBe('key-123');
        expect(config.secretAccessKey).toBe('secret-123');
        expect(config.bucketName).toBe('my-bucket');
        expect(config.publicUrl).toBe('https://cdn.test.com');

        delete process.env.R2_ACCOUNT_ID;
        delete process.env.R2_ACCESS_KEY_ID;
        delete process.env.R2_SECRET_ACCESS_KEY;
        delete process.env.R2_BUCKET_NAME;
        delete process.env.R2_PUBLIC_URL;
    });

    it('should parse R2_SIGNED_URL_EXPIRES_IN when provided', () => {
        process.env.R2_ACCOUNT_ID = 'acc';
        process.env.R2_ACCESS_KEY_ID = 'key';
        process.env.R2_SECRET_ACCESS_KEY = 'secret';
        process.env.R2_BUCKET_NAME = 'bucket';
        process.env.R2_PUBLIC_URL = 'https://cdn.test.com';
        process.env.R2_SIGNED_URL_EXPIRES_IN = '300';

        const config = loadR2ConfigFromEnv();
        expect(config.signedUrlExpiresIn).toBe(300);

        delete process.env.R2_ACCOUNT_ID;
        delete process.env.R2_ACCESS_KEY_ID;
        delete process.env.R2_SECRET_ACCESS_KEY;
        delete process.env.R2_BUCKET_NAME;
        delete process.env.R2_PUBLIC_URL;
        delete process.env.R2_SIGNED_URL_EXPIRES_IN;
    });
});
