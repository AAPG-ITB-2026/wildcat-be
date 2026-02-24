import 'dotenv/config';
import {
    S3Client,
    HeadBucketCommand,
    PutObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import {
    createR2Storage,
    type R2StorageConfig,
} from '../src/modules/upload/adapters/r2-storage.adapter.js';

function mask(value: string): string {
    if (value.length <= 8) return '***';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseArgs() {
    const args = new Set(process.argv.slice(2));
    return {
        write: args.has('--write'),
    };
}

function loadR2Config(): R2StorageConfig {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.R2_BUCKET_NAME;
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicUrl) {
        throw new Error('Missing required R2 env vars. Check .env file.');
    }

    return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

async function main() {
    const { write } = parseArgs();

    const config = loadR2Config();

    const endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
    const client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });

    const storage = createR2Storage(config);

    console.log('R2 verification started');
    console.log(`- accountId: ${mask(config.accountId)}`);
    console.log(`- accessKeyId: ${mask(config.accessKeyId)}`);
    console.log(`- bucket: ${config.bucketName}`);
    console.log(`- publicUrl: ${config.publicUrl}`);

    await client.send(new HeadBucketCommand({ Bucket: config.bucketName }));
    console.log('✔ Bucket is reachable and credentials are valid');

    const list = await storage.listFiles('__healthcheck__');
    if (list.error) {
        throw new Error(`listFiles failed: ${list.error.message}`);
    }
    console.log('✔ listFiles succeeded');

    const signPath = `__healthcheck__/sign-${Date.now()}-${randomUUID()}.txt`;
    const signed = await storage.createSignedUploadUrl(signPath, {
        upsert: true,
        contentType: 'text/plain',
    });

    if (signed.error || !signed.data) {
        throw new Error(`createSignedUploadUrl failed: ${signed.error?.message ?? 'unknown error'}`);
    }

    if (!signed.data.signedUrl.startsWith('http')) {
        throw new Error('createSignedUploadUrl returned invalid URL');
    }

    console.log('✔ createSignedUploadUrl succeeded');

    if (write) {
        const key = `__healthcheck__/write-${Date.now()}-${randomUUID()}.txt`;
        await client.send(
            new PutObjectCommand({
                Bucket: config.bucketName,
                Key: key,
                Body: `r2-check:${new Date().toISOString()}`,
                ContentType: 'text/plain',
            }),
        );

        console.log('✔ write test succeeded');

        await client.send(
            new DeleteObjectCommand({
                Bucket: config.bucketName,
                Key: key,
            }),
        );

        console.log('✔ delete test succeeded');
    }

    console.log('R2 verification passed');
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`R2 verification failed: ${message}`);
    process.exit(1);
});
