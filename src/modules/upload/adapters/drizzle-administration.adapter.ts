import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { teamAdministration } from '../../../db/schema.js';
import type { AdministrationRepository, AdministrationRecord } from '../upload.types.js';
import type { DocumentType } from '../upload.schema.js';
import { UploadError } from '../upload.errors.js';

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
            fileUrl: string,
        ): Promise<AdministrationRecord> {
            const column = FIELD_TO_COLUMN[field];

            const [row] = await db
                .insert(teamAdministration)
                .values({
                    teamId,
                    [column]: fileUrl,
                })
                .onConflictDoUpdate({
                    target: teamAdministration.teamId,
                    set: { [column]: fileUrl, verificationStatus: 'Pending' },
                })
                .returning();

            if (!row) {
                throw new UploadError('DB_WRITE_FAILED', '[AdministrationRepository] Upsert returned no rows');
            }

            return toRecord(row);
        },
    };
}
