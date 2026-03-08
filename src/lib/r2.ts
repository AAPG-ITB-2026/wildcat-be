import { createR2Storage } from '../modules/upload/adapters/r2-storage.adapter.js';
import type { Env } from '../types/index.js';

let cachedStorage: ReturnType<typeof createR2Storage> | null = null;
let cachedStorageKey: string | null = null;

export function getStorage(env: Env) {
    const storageKey = `${env.R2_ACCOUNT_ID}:${env.R2_BUCKET_NAME}:${env.R2_PUBLIC_URL}`;
    if (!cachedStorage || cachedStorageKey !== storageKey) {
        cachedStorage = createR2Storage({
            accountId: env.R2_ACCOUNT_ID,
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
            bucketName: env.R2_BUCKET_NAME,
            publicUrl: env.R2_PUBLIC_URL,
        });
        cachedStorageKey = storageKey;
    }
    return cachedStorage;
}