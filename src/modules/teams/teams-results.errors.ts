export class TeamResultsError extends Error {
    constructor(
        public readonly code: 'TEAM_ACCOUNT_REQUIRED',
        message: string,
    ) {
        super(message);
        this.name = 'TeamResultsError';
    }
}
