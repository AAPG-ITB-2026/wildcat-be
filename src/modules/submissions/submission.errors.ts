export type SubmissionErrorCode =
    | 'TEAM_NOT_FOUND'
    | 'NOT_VERIFIED'
    | 'INVALID_REQUIREMENT'
    | 'SIGNED_URL_FAILED'
    | 'DB_WRITE_FAILED';

export class SubmissionError extends Error {
    public readonly code: SubmissionErrorCode;

    constructor(code: SubmissionErrorCode, message: string) {
        super(message);
        this.name = 'SubmissionError';
        this.code = code;
    }
}
