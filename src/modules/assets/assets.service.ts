import { eq } from 'drizzle-orm';

import type { AssetServiceDeps, GuidebookResult } from './assets.types.js';
import { AssetError } from './assets.errors.js';
import { competitions } from '../../db/schema.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateCompetitionId(id: string): void {
    if (!UUID_REGEX.test(id)) {
        throw new AssetError(
            'INVALID_COMPETITION_ID',
            `"${id}" is not a valid competition ID`,
        );
    }
}

export async function getGuidebookUrl(
    competitionId: string,
    deps: AssetServiceDeps,
): Promise<GuidebookResult> {
    validateCompetitionId(competitionId);

    const [row] = await deps.db
        .select({
            id: competitions.id,
            name: competitions.name,
            guidebookUrl: competitions.guidebookUrl,
        })
        .from(competitions)
        .where(eq(competitions.id, competitionId))
        .limit(1);

    if (!row) {
        throw new AssetError(
            'COMPETITION_NOT_FOUND',
            `Competition "${competitionId}" not found`,
        );
    }

    if (!row.guidebookUrl) {
        throw new AssetError(
            'GUIDEBOOK_NOT_AVAILABLE',
            `Guidebook is not yet available for competition "${row.name}"`,
        );
    }

    return {
        competitionId: row.id,
        competitionName: row.name,
        guidebookUrl: row.guidebookUrl,
    };
}
