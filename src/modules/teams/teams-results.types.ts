export interface TeamResultsRow {
    stageName: string;
    finalScore: number;
    feedback: string | null;
}

export interface TeamAccountRepository {
    existsById(id: string): Promise<boolean>;
}

export interface TeamResultsRepository {
    listReleasedByTeamId(teamId: string): Promise<TeamResultsRow[]>;
}

export interface TeamResultsServiceDeps {
    accounts: TeamAccountRepository;
    results: TeamResultsRepository;
}
