import { eq, and, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { stageRequirements, submissions, competitionStages } from '../../../db/schema.js';
import type { SubmissionRepository, StageRequirement, SubmissionRecord } from '../submission.types.js';
import { SubmissionError } from '../submission.errors.js';
import { logInfo, logError } from '../../../middlewares/logger.js';

export function createDrizzleSubmissionRepo(db: PostgresJsDatabase): SubmissionRepository {
    return {
        async findRequirementWithStage(requirementId: string): Promise<StageRequirement | null> {
            const [row] = await db
                .select({
                    id: stageRequirements.id,
                    stageId: stageRequirements.stageId,
                    documentName: stageRequirements.documentName,
                    allowedExtensions: stageRequirements.allowedExtensions,
                    maxSizeMb: stageRequirements.maxSizeMb,
                    startDate: competitionStages.startDate,
                    endDate: competitionStages.endDate,
                })
                .from(stageRequirements)
                .innerJoin(competitionStages, eq(stageRequirements.stageId, competitionStages.id))
                .where(eq(stageRequirements.id, requirementId))
                .limit(1);

            return row ?? null;
        },

        async upsert(data): Promise<SubmissionRecord> {
            const { teamId, requirementId, fileUrl } = data;

            const [row] = await db
                .insert(submissions)
                .values({
                    teamId,
                    requirementId,
                    fileUrl,
                })
                .onConflictDoUpdate({
                    target: [submissions.teamId, submissions.requirementId],
                    set: {
                        fileUrl,
                        submittedAt: new Date(),
                    },
                })
                .returning();

            if (!row) {
                throw new SubmissionError('DB_WRITE_FAILED', '[SubmissionRepository] Upsert returned no rows');
            }

            return {
                id: row.id,
                teamId: row.teamId,
                requirementId: row.requirementId,
                fileUrl: row.fileUrl,
                isValid: row.isValid,
                submittedAt: row.submittedAt,
            };
        },

        async getSubmissionByRequirement(
            teamId: string,
            requirementId: string,
        ): Promise<SubmissionRecord | null> {
            logInfo(
                'submission.adapter.getByRequirement',
                `Querying for submission - teamId: '${teamId}' (${typeof teamId}), requirementId: '${requirementId}' (${typeof requirementId})`
            );

            const [row] = await db
                .select()
                .from(submissions)
                .where(
                    and(
                        eq(submissions.teamId, teamId),
                        eq(submissions.requirementId, requirementId)
                    )
                )
                .limit(1);

            if (!row) {
                logInfo(
                    'submission.adapter.getByRequirement',
                    `No submission found for teamId: '${teamId}', requirementId: '${requirementId}'`
                );
                return null;
            }

            logInfo(
                'submission.adapter.getByRequirement',
                `Found submission: id='${row.id}', fileUrl='${row.fileUrl}'`
            );

            return {
                id: row.id,
                teamId: row.teamId,
                requirementId: row.requirementId,
                fileUrl: row.fileUrl,
                isValid: row.isValid,
                submittedAt: row.submittedAt,
            };
        },

        async getAllTeamSubmissions(teamId: string, stageId: string): Promise<Array<SubmissionRecord & { documentName: string; requirementId: string }>> {
            const rows = await db
                .select({
                    id: submissions.id,
                    teamId: submissions.teamId,
                    requirementId: submissions.requirementId,
                    fileUrl: submissions.fileUrl,
                    isValid: submissions.isValid,
                    submittedAt: submissions.submittedAt,
                    documentName: stageRequirements.documentName,
                })
                .from(submissions)
                .innerJoin(stageRequirements, eq(submissions.requirementId, stageRequirements.id))
                .where(
                    and(
                        eq(submissions.teamId, teamId),
                        eq(stageRequirements.stageId, stageId)
                    )
                );

            return rows;
        },

        async getStageRequirementsList(stageId: string): Promise<StageRequirement[]> {
            const rows = await db
                .select({
                    id: stageRequirements.id,
                    stageId: stageRequirements.stageId,
                    documentName: stageRequirements.documentName,
                    allowedExtensions: stageRequirements.allowedExtensions,
                    maxSizeMb: stageRequirements.maxSizeMb,
                    startDate: competitionStages.startDate,
                    endDate: competitionStages.endDate,
                })
                .from(stageRequirements)
                .innerJoin(competitionStages, eq(stageRequirements.stageId, competitionStages.id))
                .where(eq(stageRequirements.stageId, stageId));

            return rows;
        },

        async getAllTeamSubmissionsBatch(
            teamIds: string[],
            stageId: string
        ): Promise<Map<string, Array<SubmissionRecord & { documentName: string; requirementId: string }>>> {
            if (teamIds.length === 0) {
                return new Map();
            }

            const rows = await db
                .select({
                    id: submissions.id,
                    teamId: submissions.teamId,
                    requirementId: submissions.requirementId,
                    fileUrl: submissions.fileUrl,
                    isValid: submissions.isValid,
                    submittedAt: submissions.submittedAt,
                    documentName: stageRequirements.documentName,
                })
                .from(submissions)
                .innerJoin(stageRequirements, eq(submissions.requirementId, stageRequirements.id))
                .where(
                    and(
                        inArray(submissions.teamId, teamIds),
                        eq(stageRequirements.stageId, stageId)
                    )
                );

            // Group results by teamId
            const map = new Map<string, Array<SubmissionRecord & { documentName: string; requirementId: string }>>();
            for (const row of rows) {
                if (!map.has(row.teamId)) {
                    map.set(row.teamId, []);
                }
                map.get(row.teamId)!.push(row);
            }

            return map;
        },
    };
}
