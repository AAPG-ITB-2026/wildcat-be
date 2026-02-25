import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { documents } from '../../../db/schema.js';
import type { DocumentRepository, DocumentRecord } from '../upload.types.js';
import { UploadError } from '../upload.errors.js';

export function createDrizzleDocumentRepo(db: PostgresJsDatabase): DocumentRepository {
    return {
        async insert(data: {
            teamId: string;
            fileUrl: string;
            isVerified: boolean;
        }): Promise<DocumentRecord> {
            const [row] = await db
                .insert(documents)
                .values({
                    teamId: data.teamId,
                    fileUrl: data.fileUrl,
                    isVerified: data.isVerified,
                })
                .returning();

            if (!row) {
                throw new UploadError('DB_WRITE_FAILED', '[DocumentRepository] Insert returned no rows');
            }

            return {
                id: row.id,
                teamId: row.teamId,
                fileUrl: row.fileUrl,
                isVerified: row.isVerified,
                createdAt: row.createdAt,
            };
        },
    };
}
