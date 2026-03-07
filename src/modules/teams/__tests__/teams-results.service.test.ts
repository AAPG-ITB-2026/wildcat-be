import { describe, expect, it, vi } from 'vitest';

import { TeamResultsError } from '../teams-results.errors.js';
import { listMyReleasedResults } from '../teams-results.service.js';
import type { TeamResultsServiceDeps } from '../teams-results.types.js';

function createMockDeps(overrides?: Partial<TeamResultsServiceDeps>): TeamResultsServiceDeps {
    return {
        accounts: {
            existsById: vi.fn().mockResolvedValue(true),
        },
        results: {
            listReleasedByTeamId: vi.fn().mockResolvedValue([
                { stageName: 'Final', finalScore: 91.5, feedback: 'Excellent work' },
            ]),
        },
        ...overrides,
    };
}

describe('teams-results.service', () => {
    it('should return released stage scores for a valid team account', async () => {
        const deps = createMockDeps();

        const result = await listMyReleasedResults('team-1', deps);

        expect(result).toHaveLength(1);
        expect(result[0]?.stageName).toBe('Final');
        expect(deps.accounts.existsById).toHaveBeenCalledWith('team-1');
        expect(deps.results.listReleasedByTeamId).toHaveBeenCalledWith('team-1');
    });

    it('should throw TEAM_ACCOUNT_REQUIRED when account does not exist', async () => {
        const deps = createMockDeps({
            accounts: {
                existsById: vi.fn().mockResolvedValue(false),
            },
        });

        await expect(listMyReleasedResults('team-404', deps)).rejects.toThrow(TeamResultsError);

        try {
            await listMyReleasedResults('team-404', deps);
        } catch (error) {
            const appError = error as TeamResultsError;
            expect(appError.code).toBe('TEAM_ACCOUNT_REQUIRED');
        }
    });
});
