export type AssetErrorCode =
    | 'INVALID_COMPETITION_ID'
    | 'COMPETITION_NOT_FOUND'
    | 'GUIDEBOOK_NOT_AVAILABLE';

export class AssetError extends Error {
    public readonly code: AssetErrorCode;

    constructor(code: AssetErrorCode, message: string) {
        super(message);
        this.name = 'AssetError';
        this.code = code;
    }
}
