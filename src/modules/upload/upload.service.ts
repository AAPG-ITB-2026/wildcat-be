import type { SignUploadInput, ConfirmUploadInput } from './upload.schema.js';
import { ALLOWED_CONTENT_TYPES } from './upload.schema.js';
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
    };
}

export async function confirmDocumentUpload(
    input: ConfirmUploadInput,
    deps: UploadServiceDeps,
): Promise<ConfirmUploadResult> {
    const { storage, administration, teams } = deps;
    const { teamId, documentType, filePath } = input;

    const team = await teams.findById(teamId);
    if (!team) {
        throw new UploadError('TEAM_NOT_FOUND', `Team ${teamId} does not exist`);
    }

    // Ensure the file path matches the expected team/documentType prefix
    const expectedPrefix = `${teamId}/${documentType}/`;
    if (!filePath.startsWith(expectedPrefix)) {
        throw new UploadError(
            'INVALID_FILE_PATH',
            `File path '${filePath}' does not match expected prefix '${expectedPrefix}' for team ${teamId} and document type ${documentType}`,
        );
    }

    // Verify the file exists in R2 and check its actual content-type
    const { data: fileMeta, error } = await storage.headFile(filePath);
    if (error || !fileMeta) {
        throw new UploadError('FILE_NOT_FOUND', `No file found at path: ${filePath}`);
    }

    // Server-side content-type enforcement
    const allowedTypes: readonly string[] = ALLOWED_CONTENT_TYPES;
    if (!allowedTypes.includes(fileMeta.contentType)) {
        throw new UploadError(
            'INVALID_CONTENT_TYPE',
            `File has content-type '${fileMeta.contentType}', allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
        );
    }

    const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit
    if (fileMeta.contentLength > MAX_SIZE_BYTES) {
        throw new UploadError(
            'INVALID_FILE_SIZE' as unknown as any,
            `File is too large: ${(fileMeta.contentLength / 1024 / 1024).toFixed(2)}MB. Max allowed is 5MB.`
        );
    }
    const fileUrl = storage.getPublicUrl(filePath);

    const record = await administration.upsertField(teamId, documentType, fileUrl);
    return { administration: record };
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
        .replace(/[^a-z0-9\-_.]/g, '')
        .replace(/\.{2,}/g, '.');
}
