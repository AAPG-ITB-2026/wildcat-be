import { and, asc, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { competitionStages, stageScores, teamAccounts } from '../../../db/schema.js';
import type {
    TeamAccountRepository,
    TeamResultsRepository,
    TeamResultsRow,
} from '../teams-results.types.js';

export function createDrizzleTeamAccountRepo(db: PostgresJsDatabase): TeamAccountRepository {
    return {
        async existsById(id: string) {
            const [team] = await db
                .select({ id: teamAccounts.id })
                .from(teamAccounts)
                .where(eq(teamAccounts.id, id))
                .limit(1);

            return Boolean(team);
        },
    };
}

export function createDrizzleTeamResultsRepo(db: PostgresJsDatabase): TeamResultsRepository {
    return {
        async listReleasedByTeamId(teamId: string): Promise<TeamResultsRow[]> {
            return db
                .select({
                    stageName: competitionStages.name,
                    finalScore: stageScores.finalScore,
                    feedback: stageScores.feedback,
                })
                .from(stageScores)
                .innerJoin(competitionStages, eq(stageScores.stageId, competitionStages.id))
                .where(
                    and(
                        eq(stageScores.teamId, teamId),
                        eq(competitionStages.isScoresReleased, true),
                    ),
                )
                .orderBy(asc(competitionStages.endDate), desc(stageScores.updatedAt));
        },
    };
}
