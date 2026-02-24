import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { teams } from '../../../db/schema.js';
import type { TeamRepository } from '../upload.types.js';

export function createDrizzleTeamRepo(db: PostgresJsDatabase): TeamRepository {
    return {
        async findById(id: string): Promise<{ id: string } | null> {
            const [row] = await db
                .select({ id: teams.id })
                .from(teams)
                .where(eq(teams.id, id))
                .limit(1);

            return row ?? null;
        },
    };
}
