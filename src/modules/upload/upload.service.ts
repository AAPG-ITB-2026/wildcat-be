import { eq, and } from 'drizzle-orm';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { db } from '../../db/index.js';

import { documents } from '../../db/schema.js';
import type { SignUploadInput, ConfirmUploadInput } from './upload.schema.js';

type DrizzleDB = typeof db;

export interface UploadServiceDeps {
    db: DrizzleDB;
    supabaseAdmin: SupabaseClient;
}

export interface SignedUploadResult {
    signedUrl: string;
    path: string;
    token: string;
}

export interface ConfirmUploadResult {
    document: {
        id: string;
        teamId: string;
        fileUrl: string;
        isVerified: boolean;
        createdAt: Date | null;
    };
}

const STORAGE_BUCKET = 'documents';

const SIGNED_URL_EXPIRY_SECONDS = 60;

export async function generateSignedUploadUrl(
    input: SignUploadInput,
    deps: UploadServiceDeps,
): Promise<SignedUploadResult> {
    const { db, supabaseAdmin } = deps;
    const { teamId, documentType, fileName } = input;

    // TODO: adjust when teams table queries are working
    // const team = await db.query.teams.findFirst({
    //   where: (teams: any, { eq }: any) => eq(teams.id, teamId),
    // });
    // if (!team) {
    //   throw new UploadError('TEAM_NOT_FOUND', `Team ${teamId} does not exist`);
    // }

    const storagePath = buildStoragePath(teamId, documentType, fileName);

    // TODO: Uncomment when SUPABASE_SERVICE_ROLE_KEY is configured in .env
    // const { data, error } = await supabaseAdmin.storage
    //   .from(STORAGE_BUCKET)
    //   .createSignedUploadUrl(storagePath, {
    //     upsert: true, // Allow re-upload (e.g., user corrects a bad scan)
    //   });
    //
    // if (error || !data) {
    //   throw new UploadError(
    //     'SIGNED_URL_FAILED',
    //     `Failed to create signed upload URL: ${error?.message ?? 'unknown error'}`,
    //   );
    // }
    //
    // return {
    //   signedUrl: data.signedUrl,
    //   path: data.path,
    //   token: data.token,
    // };

    //TODO: adjust the return object
    return {
        signedUrl: `https://placeholder.supabase.co/storage/v1/upload/sign/${storagePath}`,
        path: storagePath,
        token: 'placeholder-token',
    };
}

export async function confirmDocumentUpload(
    input: ConfirmUploadInput,
    deps: UploadServiceDeps,
): Promise<ConfirmUploadResult> {
    const { db, supabaseAdmin } = deps;
    const { teamId, documentType, filePath } = input;

    // TODO: Uncomment when teams table queries are working
    // const team = await db.query.teams.findFirst({
    //   where: (teams: any, { eq }: any) => eq(teams.id, teamId),
    // });
    // if (!team) {
    //   throw new UploadError('TEAM_NOT_FOUND', `Team ${teamId} does not exist`);
    // }

    // TODO: Uncomment when Supabase is configured
    // const { data: fileData, error: fileError } = await supabaseAdmin.storage
    //   .from(STORAGE_BUCKET)
    //   .list(filePath.split('/').slice(0, -1).join('/'), {
    //     search: filePath.split('/').pop(),
    //   });
    //
    // const fileExists = fileData && fileData.length > 0;
    // if (!fileExists) {
    //   throw new UploadError('FILE_NOT_FOUND', `No file found at path: ${filePath}`);
    // }

    const fileUrl = buildPublicUrl(filePath);

    // TODO: Uncomment when DB is ready
    // const [doc] = await db
    //   .insert(documents)
    //   .values({
    //     teamId,
    //     fileUrl,
    //     isVerified: false,
    //   })
    //   .returning();
    //
    // return { document: doc };

    return {
        document: {
            id: 'placeholder-uuid',
            teamId,
            fileUrl,
            isVerified: false,
            createdAt: new Date(),
        },
    };
}

export function buildStoragePath(
    teamId: string,
    documentType: string,
    fileName: string,
): string {
    const sanitized = sanitizeFileName(fileName);
    const timestamp = Date.now();
    return `${teamId}/${documentType}/${timestamp}_${sanitized}`;
}

export function sanitizeFileName(fileName: string): string {
    return fileName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-_.]/g, '');
}

// TODO: Replace with actual Supabase public URL construction using
//       `supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)` when configured.
function buildPublicUrl(filePath: string): string {
    // TODO: Use real SUPABASE_URL from env
    const supabaseUrl = process.env.SUPABASE_URL ?? 'https://placeholder.supabase.co';
    return `${supabaseUrl}/storage/v1/object/public/${STORAGE_BUCKET}/${filePath}`;
}

export type UploadErrorCode =
    | 'TEAM_NOT_FOUND'
    | 'SIGNED_URL_FAILED'
    | 'FILE_NOT_FOUND'
    | 'DB_WRITE_FAILED';

export class UploadError extends Error {
    public readonly code: UploadErrorCode;

    constructor(code: UploadErrorCode, message: string) {
        super(message);
        this.name = 'UploadError';
        this.code = code;
    }
}
