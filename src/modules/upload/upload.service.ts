import type { SignUploadInput, ConfirmUploadInput } from './upload.schema.js';
import type { UploadServiceDeps, SignedUploadResult, ConfirmUploadResult } from './upload.types.js';
import { UploadError } from './upload.errors.js';

export async function generateSignedUploadUrl(
    input: SignUploadInput,
    deps: UploadServiceDeps,
): Promise<SignedUploadResult> {
    const { storage, teams } = deps;
    const { teamId, documentType, fileName } = input;

    const team = await teams.findById(teamId);
    if (!team) {
        throw new UploadError('TEAM_NOT_FOUND', `Team ${teamId} does not exist`);
    }

    const storagePath = buildStoragePath(teamId, documentType, fileName);

    const { data, error } = await storage.createSignedUploadUrl(storagePath, {
        upsert: true,
        contentType: input.contentType,
    });

    if (error || !data) {
        throw new UploadError(
            'SIGNED_URL_FAILED',
            `Failed to create signed upload URL: ${error?.message ?? 'unknown error'}`,
        );
    }

    return {
        signedUrl: data.signedUrl,
        path: data.path,
        token: data.token,
    };
}

export async function confirmDocumentUpload(
    input: ConfirmUploadInput,
    deps: UploadServiceDeps,
): Promise<ConfirmUploadResult> {
    const { storage, documents, teams } = deps;
    const { teamId, filePath } = input;

    const team = await teams.findById(teamId);
    if (!team) {
        throw new UploadError('TEAM_NOT_FOUND', `Team ${teamId} does not exist`);
    }

    const { data: files, error } = await storage.listFiles(
        filePath.split('/').slice(0, -1).join('/'),
        filePath.split('/').pop(),
    );
    if (!files || files.length === 0) {
        throw new UploadError('FILE_NOT_FOUND', `No file found at path: ${filePath}`);
    }

    const fileUrl = storage.getPublicUrl(filePath);

    const document = await documents.insert({ teamId, fileUrl, isVerified: false });
    return { document };
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
