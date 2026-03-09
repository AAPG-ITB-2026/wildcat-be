import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { teamAdministration } from '../../../db/schema.js';
import type { AdministrationRepository, AdministrationRecord } from '../upload.types.js';
import type { DocumentType } from '../upload.schema.js';
import { UploadError } from '../upload.errors.js';
import { logInfo, logError } from '../../../middlewares/logger.js';

/**
 * Maps API-level document types to the corresponding
 * Drizzle column on the `teamAdministration` table.
 */
const FIELD_TO_COLUMN = {
    lead_ktm: 'leadKtm',
    m1_ktm: 'm1Ktm',
    m2_ktm: 'm2Ktm',
    twibbon_proof: 'twibbonProof',
    poster_proof: 'posterProof',
} as const satisfies Record<DocumentType, keyof typeof teamAdministration.$inferInsert>;

function toRecord(row: typeof teamAdministration.$inferSelect): AdministrationRecord {
    return {
        teamId: row.teamId,
        leadKtm: row.leadKtm,
        m1Ktm: row.m1Ktm,
        m2Ktm: row.m2Ktm,
        twibbonProof: row.twibbonProof,
        posterProof: row.posterProof,
        verificationStatus: row.verificationStatus,
    };
}

export function createDrizzleAdministrationRepo(db: PostgresJsDatabase): AdministrationRepository {
    return {
        async upsertField(
            teamId: string,
            field: DocumentType,
            filePath: string,
        ): Promise<AdministrationRecord> {
            const column = FIELD_TO_COLUMN[field];

            const [row] = await db
                .insert(teamAdministration)
                .values({
                    teamId,
                    [column]: filePath,
                })
                .onConflictDoUpdate({
                    target: teamAdministration.teamId,
                    set: { [column]: filePath, verificationStatus: 'Pending' },
                })
                .returning();

            if (!row) {
                throw new UploadError('DB_WRITE_FAILED', '[AdministrationRepository] Upsert returned no rows');
            }

            return toRecord(row);
        },

        async getField(
            teamId: string,
            field: DocumentType,
        ): Promise<string | null> {
            const column = FIELD_TO_COLUMN[field];
            logInfo('administration.getField', `Fetching ${field} (column: ${column}) for team ${teamId}`);

            const [row] = await db
                .select()
                .from(teamAdministration)
                .where(eq(teamAdministration.teamId, teamId))
                .limit(1);

            logInfo('administration.getField', `Query result:`, row);

            if (!row) {
                logError('administration.getField', `No record found for team ${teamId}`);
                return null;
            }

            // Safely access the column value from the row using the camelCase property name
            const filePath = (row as any)[column];
            logInfo('administration.getField', `File path for ${field}:`, filePath);
            return typeof filePath === 'string' ? filePath : null;
        },
    };
}
