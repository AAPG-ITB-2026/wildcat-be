import { desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
    stageRequirements,
    submissions,
    teamAccounts,
    teamAdministration,
    transactions,
} from '../../../db/schema.js';
import type {
    AdminReviewPagination,
    AdminReviewRepository,
    StageSubmissionReviewRow,
    TeamAdministrationReviewRow,
    TransactionReviewRow,
} from '../admin.types.js';

export function createDrizzleAdminReviewRepo(db: PostgresJsDatabase): AdminReviewRepository {
    return {
        async listTransactions(pagination: AdminReviewPagination): Promise<TransactionReviewRow[]> {
            return db
                .select({
                    transactionId: transactions.id,
                    teamId: teamAccounts.id,
                    teamName: teamAccounts.teamName,
                    institution: teamAccounts.institution,
                    orderId: transactions.orderId,
                    amount: transactions.amount,
                    paymentType: transactions.paymentType,
                    verificationStatus: transactions.verificationStatus,
                    verifiedBy: transactions.verifiedBy,
                    rejectionNotes: transactions.rejectionNotes,
                    createdAt: transactions.createdAt,
                    paymentProofRef: transactions.paymentProofUrl,
                })
                .from(transactions)
                .innerJoin(teamAccounts, eq(transactions.teamId, teamAccounts.id))
                .orderBy(desc(transactions.createdAt))
                .limit(pagination.limit)
                .offset(pagination.offset);
        },

        async listAdministrationDocuments(
            pagination: AdminReviewPagination,
        ): Promise<TeamAdministrationReviewRow[]> {
            return db
                .select({
                    teamId: teamAdministration.teamId,
                    teamName: teamAccounts.teamName,
                    institution: teamAccounts.institution,
                    verificationStatus: teamAdministration.verificationStatus,
                    verifiedBy: teamAdministration.verifiedBy,
                    rejectionNotes: teamAdministration.rejectionNotes,
                    leadKtmRef: teamAdministration.leadKtm,
                    twibbonProofRef: teamAdministration.twibbonProof,
                    posterProofRef: teamAdministration.posterProof,
                })
                .from(teamAdministration)
                .innerJoin(teamAccounts, eq(teamAdministration.teamId, teamAccounts.id))
                .limit(pagination.limit)
                .offset(pagination.offset);
        },

        async listStageSubmissions(
            stageId: string,
            pagination: AdminReviewPagination,
        ): Promise<StageSubmissionReviewRow[]> {
            return db
                .select({
                    submissionId: submissions.id,
                    teamId: submissions.teamId,
                    teamName: teamAccounts.teamName,
                    institution: teamAccounts.institution,
                    requirementId: submissions.requirementId,
                    documentName: stageRequirements.documentName,
                    isValid: submissions.isValid,
                    verifiedBy: submissions.verifiedBy,
                    submittedAt: submissions.submittedAt,
                    fileRef: submissions.fileUrl,
                })
                .from(submissions)
                .innerJoin(stageRequirements, eq(submissions.requirementId, stageRequirements.id))
                .innerJoin(teamAccounts, eq(submissions.teamId, teamAccounts.id))
                .where(eq(stageRequirements.stageId, stageId))
                .orderBy(desc(submissions.submittedAt))
                .limit(pagination.limit)
                .offset(pagination.offset);
        },
    };
}
