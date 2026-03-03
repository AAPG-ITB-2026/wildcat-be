import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export interface AssetServiceDeps {
    db: PostgresJsDatabase;
}

export interface GuidebookResult {
    competitionId: string;
    competitionName: string;
    guidebookUrl: string;
}
