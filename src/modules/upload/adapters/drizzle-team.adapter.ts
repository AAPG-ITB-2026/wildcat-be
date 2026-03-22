import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { teamAccounts } from '../../../db/schema.js';
import type { TeamRepository } from '../upload.types.js';

export function createDrizzleTeamRepo(db: PostgresJsDatabase): TeamRepository {
    return {
        async findById(id: string): Promise<{
            id: string;
            m1Name: string | null;
            m2Name: string | null;
            phoneNumber: string;
            lineId: string;
        } | null> {
            const [row] = await db
                .select({
                    id: teamAccounts.id,
                    m1Name: teamAccounts.m1Name,
                    m2Name: teamAccounts.m2Name,
                    phoneNumber: teamAccounts.phoneNumber,
                    lineId: teamAccounts.lineId,
                })
                .from(teamAccounts)
                .where(eq(teamAccounts.id, id))
                .limit(1);

            return row ?? null;
        },
    };
}
