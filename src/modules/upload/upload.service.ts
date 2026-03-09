import type { SignUploadInput, ConfirmUploadInput, GetDocumentInput } from './upload.schema.js';
import { ALLOWED_CONTENT_TYPES } from './upload.schema.js';
import type { UploadServiceDeps, SignedUploadResult, ConfirmUploadResult, GetDocumentResult } from './upload.types.js';
import { UploadError } from './upload.errors.js';
import { logInfo, logError } from '../../middlewares/logger.js';

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
    // Path structure: bucket/teamId/documentType.ext (e.g., wildcat2026/uuid/lead_ktm.pdf)
    const expectedPrefix = `wildcat2026/${teamId}/`;
    if (!filePath.startsWith(expectedPrefix)) {
        throw new UploadError(
            'INVALID_FILE_PATH',
            `File path '${filePath}' does not match expected prefix '${expectedPrefix}' for team ${teamId}`,
        );
    }

    // Verify the documentType matches the file path (e.g., lead_ktm.pdf contains lead_ktm)
    const fileName = filePath.split('/').pop() ?? '';
    if (!fileName.startsWith(documentType)) {
        throw new UploadError(
            'INVALID_FILE_PATH',
            `File name '${fileName}' does not match expected document type '${documentType}'`,
        );
    }

    // Strip bucket name from path for R2 API (headFile expects just the key, not bucket/key)
    const pathWithoutBucket = filePath.startsWith('wildcat2026/')
        ? filePath.substring('wildcat2026/'.length)
        : filePath;

    const { data: fileMeta, error } = await storage.headFile(pathWithoutBucket);
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
    const record = await administration.upsertField(teamId, documentType, filePath);
    return { administration: record };
}

export async function getDocument(
    input: GetDocumentInput,
    deps: UploadServiceDeps,
): Promise<GetDocumentResult> {
    const { storage, administration, teams } = deps;
    const { teamId, documentType } = input;

    logInfo('upload.getDocument', `Request for teamId=${teamId}, documentType=${documentType}`);

    const team = await teams.findById(teamId);
    if (!team) {
        logError('upload.getDocument', `Team not found: ${teamId}`);
        throw new UploadError('TEAM_NOT_FOUND', `Team ${teamId} does not exist`);
    }

    logInfo('upload.getDocument', `Team found: ${teamId}`);

    // Fetch the administration record to get the stored file path
    const record = await administration.getField(teamId, documentType);
    logInfo('upload.getDocument', `Administration record for ${documentType}:`, record);
    
    if (!record) {
        logError('upload.getDocument', `No document found for team ${teamId} with type ${documentType}`);
        throw new UploadError(
            'FILE_NOT_FOUND',
            `No document found for team ${teamId} with type ${documentType}`,
        );
    }

    // Strip bucket name from path for R2 API
    const pathWithoutBucket = record.startsWith('wildcat2026/')
        ? record.substring('wildcat2026/'.length)
        : record;

    logInfo('upload.getDocument', `File path (cleaned): ${pathWithoutBucket}`);

    // Get file metadata to determine content type
    const { data: fileMeta, error } = await storage.headFile(pathWithoutBucket);
    logInfo('upload.getDocument', 'File metadata:', { fileMeta, error });
    
    if (error || !fileMeta) {
        logError('upload.getDocument', `File metadata error: ${error?.message}`);
        throw new UploadError('FILE_NOT_FOUND', `No file found at path: ${record}`);
    }

    // Create signed download URL
    const { data: signedUrl, error: urlError } = await storage.createSignedDownloadUrl(
        pathWithoutBucket,
        3600, // 1 hour expiry
    );

    logInfo('upload.getDocument', `Signed URL created:`, { signedUrl: signedUrl ? 'OK' : 'FAILED', error: urlError?.message });

    if (urlError || !signedUrl) {
        logError('upload.getDocument', `Signed URL error: ${urlError?.message}`);
        throw new UploadError(
            'SIGNED_URL_FAILED',
            `Failed to create signed download URL: ${urlError?.message ?? 'unknown error'}`,
        );
    }

    logInfo('upload.getDocument', `Success - returning signed URL and content type: ${fileMeta.contentType}`);

    return {
        signedUrl,
        contentType: fileMeta.contentType,
    };
}

export function buildStoragePath(
    teamId: string,
    documentType: string,
    fileName: string,
): string {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? 'bin';
    return `${teamId}/${documentType}.${ext}`;
}

export function sanitizeFileName(fileName: string): string {
    return fileName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-_.]/g, '')
        .replace(/\.{2,}/g, '.');
}
