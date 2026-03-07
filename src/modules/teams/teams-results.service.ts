import { TeamResultsError } from './teams-results.errors.js';
import type { TeamResultsServiceDeps } from './teams-results.types.js';

export async function listMyReleasedResults(teamId: string, deps: TeamResultsServiceDeps) {
    const hasAccount = await deps.accounts.existsById(teamId);
    if (!hasAccount) {
        throw new TeamResultsError('TEAM_ACCOUNT_REQUIRED', 'Team account is required to access results');
    }

    return deps.results.listReleasedByTeamId(teamId);
}
