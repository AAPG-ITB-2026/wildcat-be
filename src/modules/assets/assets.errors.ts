export type AssetErrorCode =
    | 'TEAM_NOT_FOUND'
    | 'NOT_REGISTERED'
    | 'ASSET_NOT_FOUND'
    | 'SIGNED_URL_FAILED'
    | 'INVALID_FILENAME';

export class AssetError extends Error {
    public readonly code: AssetErrorCode;

    constructor(code: AssetErrorCode, message: string) {
        super(message);
        this.name = 'AssetError';
        this.code = code;
    }
}
