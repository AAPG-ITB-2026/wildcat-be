import {
    S3Client,
    PutObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { StorageClient, StorageResult } from '../upload.types.js';

export interface R2StorageConfig {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    publicUrl: string;
    signedUrlExpiresIn?: number;
}
export function createR2Storage(config: R2StorageConfig): StorageClient {
    const {
        accountId,
        accessKeyId,
        secretAccessKey,
        bucketName,
        publicUrl,
        signedUrlExpiresIn = 600,
    } = config;

    const client = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });

    return {
        async createSignedUploadUrl(
            path: string,
            options?: { upsert?: boolean; contentType?: string },
        ): Promise<StorageResult<{ signedUrl: string; path: string; token: string }>> {
            try {
                const command = new PutObjectCommand({
                    Bucket: bucketName,
                    Key: path,
                    ...(options?.contentType && { ContentType: options.contentType }),
                });

                const signedUrl = await getSignedUrl(client, command, {
                    expiresIn: signedUrlExpiresIn,
                });

                const token = randomUUID();

                return {
                    data: { signedUrl, path, token },
                    error: null,
                };
            } catch (err) {
                return {
                    data: null,
                    error: err instanceof Error ? err : new Error(String(err)),
                };
            }
        },

        async listFiles(
            folder: string,
            search?: string,
        ): Promise<StorageResult<{ name: string }[]>> {
            try {
                const prefix = search
                    ? `${folder}/${search}`
                    : `${folder}/`;

                const command = new ListObjectsV2Command({
                    Bucket: bucketName,
                    Prefix: prefix,
                    MaxKeys: 1000,
                });

                const response = await client.send(command);

                const files = (response.Contents ?? [])
                    .map((obj) => ({
                        name: obj.Key?.split('/').pop() ?? '',
                    }))
                    .filter((f) => f.name.length > 0);

                return { data: files, error: null };
            } catch (err) {
                return {
                    data: null,
                    error: err instanceof Error ? err : new Error(String(err)),
                };
            }
        },

        getPublicUrl(path: string): string {
            const base = publicUrl.replace(/\/+$/, '');
            return `${base}/${path}`;
        },
    };
}
export function loadR2ConfigFromEnv(): R2StorageConfig {
    const required = {
        accountId: process.env.R2_ACCOUNT_ID,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        bucketName: process.env.R2_BUCKET_NAME,
        publicUrl: process.env.R2_PUBLIC_URL,
    } as const;

    const missing = Object.entries(required)
        .filter(([, v]) => !v)
        .map(([k]) => k);

    if (missing.length > 0) {
        throw new Error(
            `[R2] Missing required environment variables: ${missing.join(', ')}. ` +
            'Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL.',
        );
    }

    return {
        accountId: required.accountId!,
        accessKeyId: required.accessKeyId!,
        secretAccessKey: required.secretAccessKey!,
        bucketName: required.bucketName!,
        publicUrl: required.publicUrl!,
        signedUrlExpiresIn: process.env.R2_SIGNED_URL_EXPIRES_IN
            ? Number(process.env.R2_SIGNED_URL_EXPIRES_IN)
            : undefined,
    };
}
