import type { RequestUrlInput, SaveSubmissionInput, GetSubmissionInput } from './submission.schema.js';
import type { SubmissionServiceDeps, SignedUrlResult, SubmissionRecord, GetSubmissionResult, SubmissionStatus, AllSubmissionsResult } from './submission.types.js';
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
        throw new SubmissionError('STAGE_NOT_ASSIGNED', 'Team has not been assigned to a competition stage yet');
    }

    const requirement = await submissions.findRequirementWithStage(requirement_id);
    if (!requirement) {
        throw new SubmissionError('REQUIREMENT_NOT_FOUND', 'Requirement not found');
    }

    if (requirement.stageId !== team.currentStageId) {
        throw new SubmissionError(
            'STAGE_MISMATCH',
            'Requirement does not belong to your current stage',
        );
    }

    validateFileExtension(filename, requirement.allowedExtensions);

    const storagePath = buildSubmissionPath(teamId, requirement_id, filename);

    const { data, error } = await storage.createSignedUploadUrl(storagePath, {
        contentType: input.content_type, 
    });
    
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
    const { file_path, requirement_id } = input;

    const team = await teams.findById(teamId);
    if (!team) {
        throw new SubmissionError('TEAM_NOT_FOUND', 'Team not found');
    }

    const eligibility = await gatekeeping.checkTeamEligibility(teamId);
    if (!eligibility.eligible) {
        throw new SubmissionError('NOT_VERIFIED', eligibility.reason ?? 'Team is not eligible for submissions');
    }

    if (!team.currentStageId) {
        throw new SubmissionError('STAGE_NOT_ASSIGNED', 'Team has not been assigned to a competition stage yet');
    }

    const requirement = await submissions.findRequirementWithStage(requirement_id);
    if (!requirement) {
        throw new SubmissionError('REQUIREMENT_NOT_FOUND', 'Requirement not found');
    }

    if (requirement.stageId !== team.currentStageId) {
        throw new SubmissionError(
            'STAGE_MISMATCH',
            'Requirement does not belong to your current stage',
        );
    }

    const storagePath = validateSubmittedStoragePath(teamId, requirement_id, file_path);
    const uploadedFileName = getFileNameFromStoragePath(storagePath);
    validateFileExtension(uploadedFileName, requirement.allowedExtensions);

    // validateSubmittedStoragePath already returns a clean path without bucket prefix
    console.log(`[submission] Checking file metadata for path: ${storagePath}`);
    const { data: fileMetadata, error: fileMetadataError } = await storage.headFile(storagePath);
    if (fileMetadataError || !fileMetadata) {
        // Enhanced error message with underlying R2 error details
        const errorDetails = fileMetadataError?.message || 'Unknown error';
        const errorName = fileMetadataError?.name || '';
        console.error(`[submission] File metadata check failed for path: ${storagePath}`, { errorName, errorDetails });
        throw new SubmissionError(
            'FILE_METADATA_UNAVAILABLE',
            `Unable to verify uploaded file metadata at path: ${storagePath}. Error: ${errorName ? `${errorName}: ` : ''}${errorDetails}. Ensure the file was uploaded to R2 successfully.`
        );
    }
    console.log(`[submission] File metadata verified: contentType=${fileMetadata.contentType}, contentLength=${fileMetadata.contentLength}`);

    // Server-side content-type enforcement based on stage requirement
    // allowedExtensions now contains MIME types: "application/pdf, image/png"
    const allowedContentTypes = requirement.allowedExtensions
        .split(',')
        .map((type) => type.trim().toLowerCase());
    
    if (!allowedContentTypes.includes(fileMetadata.contentType.toLowerCase())) {
        throw new SubmissionError(
            'INVALID_CONTENT_TYPE',
            `File content-type '${fileMetadata.contentType}' not allowed. Expected one of: ${allowedContentTypes.join(', ')}`
        );
    }

    const maxSizeBytes = requirement.maxSizeMb * 1024 * 1024;
    if (fileMetadata.contentLength > maxSizeBytes) {
        throw new SubmissionError(
            'FILE_TOO_LARGE',
            `Uploaded file exceeds maximum size of ${requirement.maxSizeMb} MB`,
        );
    }

    const record = await submissions.upsert({
        teamId,
        requirementId: requirement_id,
        fileUrl: file_path,
    });

    return record;
}

export async function getSubmission(
    teamId: string,
    input: GetSubmissionInput,
    deps: SubmissionServiceDeps,
): Promise<GetSubmissionResult> {
    const { storage, gatekeeping, submissions, teams } = deps;
    const { requirement_id } = input;

    console.log(`[submission.getSubmission] Request for teamId=${teamId}, requirementId=${requirement_id}`);

    const team = await teams.findById(teamId);
    if (!team) {
        console.log(`[submission.getSubmission] Team not found: ${teamId}`);
        throw new SubmissionError('TEAM_NOT_FOUND', 'Team not found');
    }

    console.log(`[submission.getSubmission] Team found: ${teamId}`);

    const eligibility = await gatekeeping.checkTeamEligibility(teamId);
    console.log(`[submission.getSubmission] Eligibility check:`, eligibility);
    
    if (!eligibility.eligible) {
        console.log(`[submission.getSubmission] Team not eligible: ${eligibility.reason}`);
        throw new SubmissionError('NOT_VERIFIED', eligibility.reason ?? 'Team is not eligible for submissions');
    }

    if (!team.currentStageId) {
        console.log(`[submission.getSubmission] No stage assigned for team ${teamId}`);
        throw new SubmissionError('STAGE_NOT_ASSIGNED', 'Team has not been assigned to a competition stage yet');
    }

    console.log(`[submission.getSubmission] Team stage: ${team.currentStageId}`);

    const requirement = await submissions.findRequirementWithStage(requirement_id);
    console.log(`[submission.getSubmission] Requirement found:`, requirement);
    
    if (!requirement) {
        console.log(`[submission.getSubmission] Requirement not found: ${requirement_id}`);
        throw new SubmissionError('REQUIREMENT_NOT_FOUND', 'Requirement not found');
    }

    if (requirement.stageId !== team.currentStageId) {
        console.log(`[submission.getSubmission] Stage mismatch - requirement stage: ${requirement.stageId}, team stage: ${team.currentStageId}`);
        throw new SubmissionError(
            'STAGE_MISMATCH',
            'Requirement does not belong to your current stage',
        );
    }

    const submission = await submissions.getSubmissionByRequirement(teamId, requirement_id);
    console.log(`[submission.getSubmission] Submission record:`, submission);
    
    if (!submission) {
        console.log(`[submission.getSubmission] No submission found for team ${teamId}, requirement ${requirement_id}`);
        throw new SubmissionError(
            'SUBMISSION_NOT_FOUND',
            'No submission found for this requirement',
        );
    }

    // Strip bucket name from path for R2 API
    const pathWithoutBucket = submission.fileUrl.startsWith('wildcat2026/')
        ? submission.fileUrl.substring('wildcat2026/'.length)
        : submission.fileUrl;

    console.log(`[submission.getSubmission] File path (cleaned): ${pathWithoutBucket}`);

    // Get file metadata to determine content type
    const { data: fileMeta, error } = await storage.headFile(pathWithoutBucket);
    console.log(`[submission.getSubmission] File metadata:`, { fileMeta, error });
    
    if (error || !fileMeta) {
        console.log(`[submission.getSubmission] File metadata error: ${error?.message}`);
        throw new SubmissionError('FILE_NOT_FOUND', `No file found at path: ${submission.fileUrl}`);
    }

    // Create signed download URL
    const { data: signedUrl, error: urlError } = await storage.createSignedDownloadUrl(
        pathWithoutBucket,
        3600, // 1 hour expiry
    );

    console.log(`[submission.getSubmission] Signed URL created:`, { signedUrl: signedUrl ? 'OK' : 'FAILED', error: urlError?.message });

    if (urlError || !signedUrl) {
        console.log(`[submission.getSubmission] Signed URL error: ${urlError?.message}`);
        throw new SubmissionError(
            'SIGNED_URL_FAILED',
            `Failed to create signed download URL: ${urlError?.message ?? 'unknown error'}`,
        );
    }

    console.log(`[submission.getSubmission] Success - returning signed URL, contentType=${fileMeta.contentType}, documentName=${requirement.documentName}`);

    return {
        signedUrl,
        contentType: fileMeta.contentType,
        documentName: requirement.documentName,
    };
}

export function validateFileExtension(filename: string, allowedMimeTypes: string): void {
    // Note: allowedMimeTypes parameter now contains MIME types like "application/pdf, image/png"
    // This function performs basic filename validation
    // Actual MIME type validation happens later via content-type header check
    
    const dotIndex = filename.lastIndexOf('.');
    if (dotIndex <= 0 || dotIndex === filename.length - 1) {
        throw new SubmissionError('INVALID_EXTENSION', 'Filename must have an extension');
    }

    const ext = filename.slice(dotIndex + 1).toLowerCase();
    if (!ext || ext.length === 0) {
        throw new SubmissionError(
            'INVALID_EXTENSION',
            `File must have a valid extension. Allowed MIME types: ${allowedMimeTypes}`,
        );
    }
}

export function buildSubmissionPath(
    teamId: string,
    requirementId: string,
    filename: string,
): string {
    // Extract file extension from the original filename
    const extension = getFileExtension(filename);
    
    // Static naming: submissions/{teamId}/{requirementId}.{ext}
    return `submissions/${teamId}/${requirementId}${extension}`;
}

export function getFileExtension(filename: string): string {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1 || lastDotIndex === 0) {
        return ''; // No extension
    }
    return filename.substring(lastDotIndex).toLowerCase();
}

export function sanitizeFileName(fileName: string): string {
    return fileName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9\-_.]/g, '')
        .replace(/\.{2,}/g, '.');
}

function validateSubmittedStoragePath(teamId: string, requirementId: string, filePath: string): string {
    if (filePath.includes('..') || filePath.includes('//') || filePath.startsWith('/')) {
        throw new SubmissionError('INVALID_STORAGE_PATH', 'Invalid file path');
    }

    // Strip bucket prefix if present for validation
    const cleanPath = filePath.startsWith('wildcat2026/')
        ? filePath.substring('wildcat2026/'.length)
        : filePath;

    // Validate path structure: submissions/{teamId}/{requirementId}.{ext}
    const pathParts = cleanPath.split('/');
    if (pathParts.length !== 3 || pathParts[0] !== 'submissions') {
        throw new SubmissionError(
            'INVALID_STORAGE_PATH',
            'file_path must follow structure: submissions/{teamId}/{requirementId}.{ext}',
        );
    }

    const [, pathTeamId, fileWithExt] = pathParts;
    
    if (pathTeamId !== teamId) {
        throw new SubmissionError(
            'INVALID_STORAGE_PATH',
            `file_path teamId must match request (expected ${teamId}, got ${pathTeamId})`,
        );
    }

    // Extract requirementId from the file part (e.g., "abc123.pdf" -> "abc123")
    const lastDotIndex = fileWithExt.lastIndexOf('.');
    const pathRequirementId = lastDotIndex > 0 ? fileWithExt.substring(0, lastDotIndex) : fileWithExt;
    
    if (pathRequirementId !== requirementId) {
        throw new SubmissionError(
            'INVALID_STORAGE_PATH',
            `file_path requirementId must match request (expected ${requirementId}, got ${pathRequirementId})`,
        );
    }

    return cleanPath;
}

function getFileNameFromStoragePath(storagePath: string): string {
    const fileName = storagePath.split('/').pop();
    if (!fileName) {
        throw new SubmissionError('INVALID_STORAGE_PATH', 'file_path must point to a valid file path');
    }

    return fileName;
}

export async function listAllSubmissions(
    teamId: string,
    deps: SubmissionServiceDeps,
): Promise<AllSubmissionsResult> {
    const { submissions, teams } = deps;

    const team = await teams.findById(teamId);
    if (!team) {
        throw new SubmissionError('TEAM_NOT_FOUND', 'Team not found');
    }

    if (!team.currentStageId) {
        throw new SubmissionError('STAGE_NOT_ASSIGNED', 'Team has not been assigned to a competition stage yet');
    }

    // Get all requirements for the current stage
    const requirements = await submissions.getStageRequirementsList(team.currentStageId);
    
    // Get all submissions for this team in the current stage
    const teamSubmissions = await submissions.getAllTeamSubmissions(teamId, team.currentStageId);

    // Create a map of submitted requirements for quick lookup
    const submissionMap = new Map(teamSubmissions.map(s => [s.requirementId, s]));

    // Build the submission status list
    const submissionStatuses: SubmissionStatus[] = requirements.map(req => {
        const submission = submissionMap.get(req.id);
        return {
            requirementId: req.id,
            documentName: req.documentName,
            submitted: !!submission,
            isValid: submission?.isValid ?? false,
            submittedAt: submission?.submittedAt ?? null,
            fileUrl: submission?.fileUrl ?? null,
        };
    });

    const submittedCount = submissionStatuses.filter(s => s.submitted).length;
    const completionPercentage = requirements.length > 0 
        ? Math.round((submittedCount / requirements.length) * 100) 
        : 0;

    return {
        submissions: submissionStatuses,
        totalRequirements: requirements.length,
        submittedCount,
        completionPercentage,
    };
}

export async function getSubmissionStatus(
    teamId: string,
    deps: SubmissionServiceDeps,
): Promise<AllSubmissionsResult> {
    // This is an alias for listAllSubmissions with a more semantic name
    return listAllSubmissions(teamId, deps);
}
