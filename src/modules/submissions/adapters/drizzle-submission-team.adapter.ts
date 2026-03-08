import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { teamAccounts } from '../../../db/schema.js';
import type { SubmissionTeamRepository, TeamWithStage } from '../submission.types.js';

export function createDrizzleSubmissionTeamRepo(db: PostgresJsDatabase): SubmissionTeamRepository {
    return {
        async findById(id: string): Promise<TeamWithStage | null> {
            const [row] = await db
                .select({
                    id: teamAccounts.id,
                    currentStageId: teamAccounts.currentStageId,
                })
                .from(teamAccounts)
                .where(eq(teamAccounts.id, id))
                .limit(1);

            return row ?? null;
        },
    };
}
