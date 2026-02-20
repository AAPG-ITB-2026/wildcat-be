import type { SignUploadInput, ConfirmUploadInput } from './upload.schema.js';
import type { UploadServiceDeps, SignedUploadResult, ConfirmUploadResult } from './upload.types.js';
import { UploadError } from './upload.errors.js';

const STORAGE_BUCKET = 'documents';

export async function generateSignedUploadUrl(
    input: SignUploadInput,
    deps: UploadServiceDeps,
): Promise<SignedUploadResult> {
    const { storage, teams } = deps;
    const { teamId, documentType, fileName } = input;

    // TODO: Uncomment when TeamRepository adapter is implemented
    // const team = await teams.findById(teamId);
    // if (!team) {
    //     throw new UploadError('TEAM_NOT_FOUND', `Team ${teamId} does not exist`);
    // }

    const storagePath = buildStoragePath(teamId, documentType, fileName);

    // TODO: Uncomment when StorageClient adapter is implemented
    // const { data, error } = await storage.createSignedUploadUrl(storagePath, { upsert: true });
    //
    // if (error || !data) {
    //     throw new UploadError(
    //         'SIGNED_URL_FAILED',
    //         `Failed to create signed upload URL: ${error?.message ?? 'unknown error'}`,
    //     );
    // }
    //
    // return {
    //     signedUrl: data.signedUrl,
    //     path: data.path,
    //     token: data.token,
    // };

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
    const { storage, documents, teams } = deps;
    const { teamId, filePath } = input;

    // TODO: Uncomment when TeamRepository adapter is implemented
    // const team = await teams.findById(teamId);
    // if (!team) {
    //     throw new UploadError('TEAM_NOT_FOUND', `Team ${teamId} does not exist`);
    // }

    // TODO: Uncomment when StorageClient adapter is implemented
    // const { data: files, error } = await storage.listFiles(
    //     filePath.split('/').slice(0, -1).join('/'),
    //     filePath.split('/').pop(),
    // );
    // if (!files || files.length === 0) {
    //     throw new UploadError('FILE_NOT_FOUND', `No file found at path: ${filePath}`);
    // }

    // TODO: Use storage.getPublicUrl(filePath) when StorageClient adapter is implemented
    const fileUrl = `https://placeholder.supabase.co/storage/v1/object/public/${STORAGE_BUCKET}/${filePath}`;

    // TODO: Uncomment when DocumentRepository adapter is implemented
    // const document = await documents.insert({ teamId, fileUrl, isVerified: false });
    // return { document };

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
