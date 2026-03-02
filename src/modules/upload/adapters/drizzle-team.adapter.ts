import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { teamAccounts } from '../../../db/schema.js';
import type { TeamRepository } from '../upload.types.js';

export function createDrizzleTeamRepo(db: PostgresJsDatabase): TeamRepository {
    return {
        async findById(id: string): Promise<{ id: string } | null> {
            const [row] = await db
                .select({ id: teamAccounts.id })
                .from(teamAccounts)
                .where(eq(teamAccounts.id, id))
                .limit(1);

            return row ?? null;
        },
    };
}
