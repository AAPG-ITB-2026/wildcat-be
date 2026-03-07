import type { StorageClient } from '../../shared/storage/storage.types.js';

export interface SignedFileView {
    originalFileRef: string | null;
    objectKey: string | null;
    downloadUrl: string | null;
}

export interface TransactionReviewRow {
    transactionId: string;
    teamId: string;
    teamName: string;
    institution: string;
    orderId: string;
    amount: string;
    paymentType: string;
    verificationStatus: 'Pending' | 'Verified' | 'Rejected';
    verifiedBy: string | null;
    rejectionNotes: string | null;
    createdAt: Date;
    paymentProofRef: string | null;
}

export interface TeamAdministrationReviewRow {
    teamId: string;
    teamName: string;
    institution: string;
    verificationStatus: 'Pending' | 'Verified' | 'Rejected';
    verifiedBy: string | null;
    rejectionNotes: string | null;
    leadKtmRef: string | null;
    twibbonProofRef: string | null;
    posterProofRef: string | null;
}

export interface StageSubmissionReviewRow {
    submissionId: string;
    teamId: string;
    teamName: string;
    institution: string;
    requirementId: string;
    documentName: string;
    isValid: boolean;
    verifiedBy: string | null;
    submittedAt: Date;
    fileRef: string;
}

export interface AdminReviewPagination {
    limit: number;
    offset: number;
}

export interface AdminReviewRepository {
    listTransactions(pagination: AdminReviewPagination): Promise<TransactionReviewRow[]>;
    listAdministrationDocuments(pagination: AdminReviewPagination): Promise<TeamAdministrationReviewRow[]>;
    listStageSubmissions(stageId: string, pagination: AdminReviewPagination): Promise<StageSubmissionReviewRow[]>;
}

export interface AdminReviewServiceDeps {
    storage: StorageClient;
    reviews: AdminReviewRepository;
}
