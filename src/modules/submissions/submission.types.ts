import type { StorageClient } from '../upload/upload.types.js';

export interface GatekeepingRepository {
    checkTeamEligibility(teamId: string): Promise<{
        eligible: boolean;
        reason?: string;
    }>;
}

export interface StageRequirement {
    id: string;
    stageId: string;
    documentName: string;
    allowedExtensions: string;
    maxSizeMb: number;
}

export interface SubmissionRecord {
    id: string;
    teamId: string;
    requirementId: string;
    fileUrl: string;
    isValid: boolean;
    submittedAt: Date;
}

export interface SubmissionRepository {
    findRequirementWithStage(requirementId: string): Promise<StageRequirement | null>;

    upsert(data: {
        teamId: string;
        requirementId: string;
        fileUrl: string;
    }): Promise<SubmissionRecord>;
}

export interface TeamWithStage {
    id: string;
    currentStageId: string | null;
}

export interface SubmissionTeamRepository {
    findById(id: string): Promise<TeamWithStage | null>;
}

export interface SubmissionServiceDeps {
    storage: StorageClient;
    gatekeeping: GatekeepingRepository;
    submissions: SubmissionRepository;
    teams: SubmissionTeamRepository;
}

export interface SignedUrlResult {
    signedUrl: string;
    path: string;
    maxSizeMb: number;
    allowedExtensions: string;
}
