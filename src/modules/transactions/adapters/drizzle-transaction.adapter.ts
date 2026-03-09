import { eq } from 'drizzle-orm';
import { transactions, teamAccounts, competitions } from '../../../db/schema.js';
import type {
    TransactionRecord,
    TransactionRepository,
    TeamWithCompetition,
    TeamCompetitionRepository,
} from '../transaction.types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = ReturnType<typeof import('../../../db/index.js').createDb>;

// ─── Transaction Repository ──────────────────────────────────────────────────
export function createDrizzleTransactionRepo(db: DrizzleDb): TransactionRepository {
    return {
        async findByTeamId(teamId: string): Promise<TransactionRecord | null> {
            const [row] = await db
                .select()
                .from(transactions)
                .where(eq(transactions.teamId, teamId))
                .limit(1);
            return (row as TransactionRecord | undefined) ?? null;
        },

        async findById(id: string): Promise<TransactionRecord | null> {
            const [row] = await db
                .select()
                .from(transactions)
                .where(eq(transactions.id, id))
                .limit(1);
            return (row as TransactionRecord | undefined) ?? null;
        },

        async upsertPaymentProof(
            teamId: string,
            paymentProofUrl: string,
            paymentType: string,
            amount: string,
            orderId: string,
        ): Promise<TransactionRecord> {
            // Check for an existing transaction for this team
            const [existing] = await db
                .select()
                .from(transactions)
                .where(eq(transactions.teamId, teamId))
                .limit(1);

            if (existing) {
                // Update existing — keep original orderId & amount
                const [updated] = await db
                    .update(transactions)
                    .set({
                        paymentProofUrl,
                        paymentType,
                        verificationStatus: 'Pending',
                    })
                    .where(eq(transactions.id, existing.id))
                    .returning();
                return updated as TransactionRecord;
            }

            // Create new transaction for manual payment
            const [created] = await db
                .insert(transactions)
                .values({
                    teamId,
                    orderId,
                    amount,
                    paymentType,
                    paymentProofUrl,
                    verificationStatus: 'Pending',
                })
                .returning();
            return created as TransactionRecord;
        },

        async updateVerificationStatus(
            transactionId: string,
            status: 'Verified' | 'Rejected',
            verifiedBy: string,
            rejectionNotes?: string,
        ): Promise<TransactionRecord | null> {
            const [updated] = await db
                .update(transactions)
                .set({
                    verificationStatus: status,
                    verifiedBy,
                    rejectionNotes: status === 'Rejected' ? (rejectionNotes ?? null) : null,
                })
                .where(eq(transactions.id, transactionId))
                .returning();
            return (updated as TransactionRecord | undefined) ?? null;
        },
    };
}

// ─── Team + Competition Repository ───────────────────────────────────────────
export function createDrizzleTeamCompetitionRepo(db: DrizzleDb): TeamCompetitionRepository {
    return {
        async findTeamWithCompetition(teamId: string): Promise<TeamWithCompetition | null> {
            const [row] = await db
                .select({
                    id: teamAccounts.id,
                    competitionId: teamAccounts.competitionId,
                    earlyBirdFee: competitions.earlyBirdFee,
                    normalBirdFee: competitions.normalBirdFee,
                    earlyBirdDeadline: competitions.earlyBirdDeadline,
                })
                .from(teamAccounts)
                .innerJoin(competitions, eq(teamAccounts.competitionId, competitions.id))
                .where(eq(teamAccounts.id, teamId))
                .limit(1);
            return (row as TeamWithCompetition | undefined) ?? null;
        },
    };
}
