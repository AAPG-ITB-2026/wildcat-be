import {
    S3Client,
    GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AssetStorageClient, StorageResult } from '../assets.types.js';

export interface R2AssetStorageConfig {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    signedUrlExpiresIn?: number;
}

export function createR2AssetStorage(config: R2AssetStorageConfig): AssetStorageClient {
    const {
        accountId,
        accessKeyId,
        secretAccessKey,
        bucketName,
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
        async createSignedDownloadUrl(
            path: string,
            expiresIn?: number,
        ): Promise<StorageResult<{ signedUrl: string }>> {
            try {
                const command = new GetObjectCommand({
                    Bucket: bucketName,
                    Key: path,
                });

                const signedUrl = await getSignedUrl(client, command, {
                    expiresIn: expiresIn ?? signedUrlExpiresIn,
                });

                return { data: { signedUrl }, error: null };
            } catch (err) {
                return {
                    data: null,
                    error: err instanceof Error ? err : new Error(String(err)),
                };
            }
        },
    };
}
