import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export interface AssetServiceDeps {
    db: PostgresJsDatabase;
    publicAssetUrl: string;
}

export interface GuidebookResult {
    competitionId: string;
    competitionName: string;
    guidebookUrl: string;
}
