import type { StorageClient } from '../upload/upload.types.js';

export interface TransactionRecord {
    id: string;
    teamId: string;
    orderId: string;
    amount: string;
    paymentType: string;
    paymentProofUrl: string | null;
    verificationStatus: 'Pending' | 'Verified' | 'Rejected';
    verifiedBy: string | null;
    rejectionNotes: string | null;
    createdAt: Date;
}

export interface TransactionRepository {
    findByTeamId(teamId: string): Promise<TransactionRecord | null>;
    findById(id: string): Promise<TransactionRecord | null>;

    upsertPaymentProof(
        teamId: string,
        paymentProofUrl: string,
        paymentType: string,
        amount: string,
        orderId: string,
    ): Promise<TransactionRecord>;

    updateVerificationStatus(
        transactionId: string,
        status: 'Verified' | 'Rejected',
        verifiedBy: string,
        rejectionNotes?: string,
    ): Promise<TransactionRecord | null>;
}

export interface TeamWithCompetition {
    id: string;
    competitionId: string;
    earlyBirdFee: string;
    normalBirdFee: string;
    earlyBirdDeadline: Date;
}

export interface TeamCompetitionRepository {
    findTeamWithCompetition(teamId: string): Promise<TeamWithCompetition | null>;
}

export interface TransactionServiceDeps {
    storage: StorageClient;
    transactions: TransactionRepository;
    teams: TeamCompetitionRepository;
}

export interface SignedPaymentUrlResult {
    signedUrl: string;
    path: string;
}

export interface SubmitPaymentProofResult {
    transaction: TransactionRecord;
}
