export type TransactionErrorCode =
    | 'TEAM_NOT_FOUND'
    | 'TRANSACTION_NOT_FOUND'
    | 'SIGNED_URL_FAILED'
    | 'FILE_NOT_FOUND'
    | 'INVALID_CONTENT_TYPE'
    | 'FILE_TOO_LARGE'
    | 'DB_WRITE_FAILED';

export class TransactionError extends Error {
    public readonly code: TransactionErrorCode;

    constructor(code: TransactionErrorCode, message: string) {
        super(message);
        this.name = 'TransactionError';
        this.code = code;
    }
}
