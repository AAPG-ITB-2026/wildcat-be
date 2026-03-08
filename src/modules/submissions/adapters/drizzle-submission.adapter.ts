import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { stageRequirements, submissions } from '../../../db/schema.js';
import type { SubmissionRepository, StageRequirement, SubmissionRecord } from '../submission.types.js';
import { SubmissionError } from '../submission.errors.js';

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
                })
                .from(stageRequirements)
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
    };
}
