export type UploadErrorCode =
    | 'TEAM_NOT_FOUND'
    | 'SIGNED_URL_FAILED'
    | 'FILE_NOT_FOUND'
    | 'INVALID_CONTENT_TYPE'
    | 'INVALID_FILE_PATH'
    | 'INVALID_FILE_SIZE'
    | 'INVALID_MEMBER'
    | 'DB_WRITE_FAILED'
    | 'INCOMPLETE_TEAM_INFO'
    | 'INCOMPLETE_DOCUMENTS';

export class UploadError extends Error {
    public readonly code: UploadErrorCode;

    constructor(code: UploadErrorCode, message: string) {
        super(message);
        this.name = 'UploadError';
        this.code = code;
    }
}
