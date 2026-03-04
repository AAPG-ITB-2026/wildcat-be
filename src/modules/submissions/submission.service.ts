import type { RequestUrlInput, SaveSubmissionInput } from './submission.schema.js';
import type { SubmissionServiceDeps, SignedUrlResult, SubmissionRecord } from './submission.types.js';
import { SubmissionError } from './submission.errors.js';

export async function requestPresignedUrl(
    teamId: string,
    input: RequestUrlInput,
    deps: SubmissionServiceDeps,
): Promise<SignedUrlResult> {
    const { storage, gatekeeping, submissions, teams } = deps;
    const { filename, requirement_id } = input;

    const team = await teams.findById(teamId);
    if (!team) {
        throw new SubmissionError('TEAM_NOT_FOUND', 'Team not found');
    }

    const eligibility = await gatekeeping.checkTeamEligibility(teamId);
    if (!eligibility.eligible) {
        throw new SubmissionError('NOT_VERIFIED', eligibility.reason ?? 'Team is not eligible for submissions');
    }

    if (!team.currentStageId) {
        throw new SubmissionError('INVALID_REQUIREMENT', 'Team has not been assigned to a competition stage yet');
    }

    const requirement = await submissions.findRequirementWithStage(requirement_id);
    if (!requirement) {
        throw new SubmissionError('INVALID_REQUIREMENT', 'Requirement not found');
    }

    if (requirement.stageId !== team.currentStageId) {
        throw new SubmissionError(
            'INVALID_REQUIREMENT',
            'Requirement does not belong to your current stage',
        );
    }

    validateFileExtension(filename, requirement.allowedExtensions);

    const storagePath = buildSubmissionPath(teamId, requirement_id, filename);

    const { data, error } = await storage.createSignedUploadUrl(storagePath, {});

    if (error || !data) {
        throw new SubmissionError(
            'SIGNED_URL_FAILED',
            `Failed to create signed upload URL: ${error?.message ?? 'unknown error'}`,
        );
    }

    return {
        signedUrl: data.signedUrl,
        path: data.path,
        maxSizeMb: requirement.maxSizeMb,
        allowedExtensions: requirement.allowedExtensions,
    };
}

export async function saveSubmission(
    teamId: string,
    input: SaveSubmissionInput,
    deps: SubmissionServiceDeps,
): Promise<SubmissionRecord> {
    const { storage, gatekeeping, submissions, teams } = deps;
    const { file_url, requirement_id } = input;

    const team = await teams.findById(teamId);
    if (!team) {
        throw new SubmissionError('TEAM_NOT_FOUND', 'Team not found');
    }

    const eligibility = await gatekeeping.checkTeamEligibility(teamId);
    if (!eligibility.eligible) {
        throw new SubmissionError('NOT_VERIFIED', eligibility.reason ?? 'Team is not eligible for submissions');
    }

    if (!team.currentStageId) {
        throw new SubmissionError('INVALID_REQUIREMENT', 'Team has not been assigned to a competition stage yet');
    }

    const requirement = await submissions.findRequirementWithStage(requirement_id);
    if (!requirement) {
        throw new SubmissionError('INVALID_REQUIREMENT', 'Requirement not found');
    }

    if (requirement.stageId !== team.currentStageId) {
        throw new SubmissionError(
            'INVALID_REQUIREMENT',
            'Requirement does not belong to your current stage',
        );
    }

    const storagePath = extractSubmissionStoragePath(storage, file_url);
    const uploadedFileName = getFileNameFromStoragePath(storagePath);
    validateFileExtension(uploadedFileName, requirement.allowedExtensions);

    const { data: fileMetadata, error: fileMetadataError } = await storage.headFile(storagePath);
    if (fileMetadataError || !fileMetadata) {
        throw new SubmissionError('INVALID_REQUIREMENT', 'Unable to verify uploaded file metadata');
    }

    const maxSizeBytes = requirement.maxSizeMb * 1024 * 1024;
    if (fileMetadata.contentLength > maxSizeBytes) {
        throw new SubmissionError(
            'INVALID_REQUIREMENT',
            `Uploaded file exceeds maximum size of ${requirement.maxSizeMb} MB`,
        );
    }

    const record = await submissions.upsert({
        teamId,
        requirementId: requirement_id,
        fileUrl: file_url,
    });

    return record;
}

export function validateFileExtension(filename: string, allowedExtensions: string): void {
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === filename.length - 1) {
        throw new SubmissionError('INVALID_REQUIREMENT', 'Filename must have an extension');
    }

    const ext = filename.slice(dotIndex + 1).toLowerCase();

    const allowed = allowedExtensions
        .split(',')
        .map((e) => e.trim().toLowerCase().replace(/^\./, ''));

    if (!allowed.includes(ext)) {
        throw new SubmissionError(
            'INVALID_REQUIREMENT',
            `File extension '.${ext}' is not allowed. Allowed: ${allowed.map((e) => `.${e}`).join(', ')}`,
        );
    }
}

export function buildSubmissionPath(
    teamId: string,
    requirementId: string,
    filename: string,
): string {
    const sanitized = sanitizeFileName(filename);
    const timestamp = Date.now();
    return `submissions/${teamId}/${requirementId}/${timestamp}_${sanitized}`;
}

export function sanitizeFileName(fileName: string): string {
    return fileName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-_.]/g, '')
        .replace(/\.{2,}/g, '.');
}

function extractSubmissionStoragePath(storage: SubmissionServiceDeps['storage'], fileUrl: string): string {
    const publicBaseUrl = storage.getPublicUrl('').replace(/\/+$/, '');
    const expectedPrefix = `${publicBaseUrl}/submissions/`;

    if (!fileUrl.startsWith(expectedPrefix)) {
        throw new SubmissionError('INVALID_REQUIREMENT', 'file_url must point to the submissions storage bucket');
    }

    return fileUrl.slice(publicBaseUrl.length + 1);
}

function getFileNameFromStoragePath(storagePath: string): string {
    const fileName = storagePath.split('/').pop();
    if (!fileName) {
        throw new SubmissionError('INVALID_REQUIREMENT', 'file_url must point to a valid file path');
    }

    return fileName;
}
