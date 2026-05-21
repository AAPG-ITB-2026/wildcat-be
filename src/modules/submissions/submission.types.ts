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
    startDate: Date;
    endDate: Date;
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

    getSubmissionByRequirement(
        teamId: string,
        requirementId: string,
    ): Promise<SubmissionRecord | null>;

    getAllTeamSubmissions(teamId: string, stageId: string): Promise<Array<SubmissionRecord & { documentName: string; requirementId: string }>>;

    getAllTeamSubmissionsBatch(teamIds: string[], stageId: string): Promise<Map<string, Array<SubmissionRecord & { documentName: string; requirementId: string }>>>;

    getStageRequirementsList(stageId: string): Promise<StageRequirement[]>;
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

export interface GetSubmissionResult {
    signedUrl: string;
    contentType: string;
    documentName: string;
}

export interface SubmissionStatus {
    requirementId: string;
    documentName: string;
    submitted: boolean;
    isValid: boolean;
    submittedAt: Date | null;
    fileUrl: string | null;
}

export interface AllSubmissionsResult {
    submissions: SubmissionStatus[];
    totalRequirements: number;
    submittedCount: number;
    completionPercentage: number;
}
