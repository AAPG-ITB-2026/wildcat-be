import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { teams } from '../../../db/schema.js';
import type { AssetTeamRepository } from '../assets.types.js';

export function createDrizzleAssetTeamRepo(db: PostgresJsDatabase): AssetTeamRepository {
    return {
        async findByUserId(userId: string): Promise<{ id: string; status: string } | null> {
            const [row] = await db
                .select({ id: teams.id, status: teams.status })
                .from(teams)
                .where(eq(teams.userId, userId))
                .limit(1);

            return row ?? null;
        },
    };
}
