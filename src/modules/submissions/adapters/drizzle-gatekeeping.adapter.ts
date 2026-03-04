import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { teamAdministration, transactions } from '../../../db/schema.js';
import type { GatekeepingRepository } from '../submission.types.js';

export function createDrizzleGatekeepingRepo(db: PostgresJsDatabase): GatekeepingRepository {
    return {
        async checkTeamEligibility(teamId: string) {
            const [admin] = await db
                .select({ verificationStatus: teamAdministration.verificationStatus })
                .from(teamAdministration)
                .where(eq(teamAdministration.teamId, teamId))
                .limit(1);

            if (!admin || admin.verificationStatus !== 'Verified') {
                return {
                    eligible: false,
                    reason: 'Complete administration and payment first.',
                };
            }

            const [payment] = await db
                .select({ verificationStatus: transactions.verificationStatus })
                .from(transactions)
                .where(
                    and(
                        eq(transactions.teamId, teamId),
                        eq(transactions.verificationStatus, 'Verified'),
                    ),
                )
                .limit(1);

            if (!payment) {
                return {
                    eligible: false,
                    reason: 'Complete administration and payment first.',
                };
            }

            return { eligible: true };
        },
    };
}
