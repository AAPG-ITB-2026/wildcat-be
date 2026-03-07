export type SubmissionErrorCode =
    | 'TEAM_NOT_FOUND'
    | 'NOT_VERIFIED'
    | 'STAGE_NOT_ASSIGNED'
    | 'REQUIREMENT_NOT_FOUND'
    | 'STAGE_MISMATCH'
    | 'INVALID_EXTENSION'
    | 'INVALID_STORAGE_PATH'
    | 'FILE_METADATA_UNAVAILABLE'
    | 'FILE_TOO_LARGE'
    | 'INVALID_CONTENT_TYPE'
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
