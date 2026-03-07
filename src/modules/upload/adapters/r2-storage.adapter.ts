import {
    S3Client,
    PutObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
    GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
            options?: { contentType?: string },
        ): Promise<StorageResult<{ signedUrl: string; path: string }>> {
            try {
                const command = new PutObjectCommand({
                    Bucket: bucketName,
                    Key: path,
                    ...(options?.contentType && { ContentType: options.contentType }),
                });

                const signedUrl = await getSignedUrl(client, command, {
                    expiresIn: signedUrlExpiresIn,
                });

                return {
                    data: { signedUrl, path },
                    error: null,
                };
            } catch (err) {
                return {
                    data: null,
                    error: err instanceof Error ? err : new Error(String(err)),
                };
            }
        },
        
        async createSignedDownloadUrl(
            path: string,
            expiresIn = 3600 // Default 1 hour
        ): Promise<StorageResult<string>> {
            try {
                const command = new GetObjectCommand({
                    Bucket: bucketName,
                    Key: path,
                });

                const signedUrl = await getSignedUrl(client, command, { expiresIn });
                return { data: signedUrl, error: null };
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

        async headFile(
            path: string,
        ): Promise<StorageResult<{ contentType: string; contentLength: number }>> {
            try {
                const command = new HeadObjectCommand({
                    Bucket: bucketName,
                    Key: path,
                });

                const response = await client.send(command);

                return {
                    data: {
                        contentType: response.ContentType ?? 'application/octet-stream',
                        contentLength: response.ContentLength ?? 0,
                    },
                    error: null,
                };
            } catch (err) {
                return {
                    data: null,
                    error: err instanceof Error ? err : new Error(String(err)),
                };
            }
        },
    };
}

