export type UploadErrorCode =
    | 'TEAM_NOT_FOUND'
    | 'SIGNED_URL_FAILED'
    | 'FILE_NOT_FOUND'
    | 'INVALID_FILE_PATH'
    | 'INVALID_CONTENT_TYPE'
    | 'DB_WRITE_FAILED';

export class UploadError extends Error {
    public readonly code: UploadErrorCode;

    constructor(code: UploadErrorCode, message: string) {
        super(message);
        this.name = 'UploadError';
        this.code = code;
    }
}
