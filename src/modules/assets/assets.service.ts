import type { AssetServiceDeps, AssetDownloadResult } from './assets.types.js';
import { AssetError } from './assets.errors.js';

const ALLOWED_STATUSES: ReadonlySet<string> = new Set([
    'Registered',
    'Document_Verified',
    'Paid',
]);

const DEFAULT_EXPIRES_IN = 600;

const ASSET_PREFIX = 'assets';

export async function getRestrictedAsset(
    userId: string,
    fileName: string,
    deps: AssetServiceDeps,
): Promise<AssetDownloadResult> {
    validateFileName(fileName);

    const team = await deps.teams.findByUserId(userId);
    if (!team) {
        throw new AssetError('TEAM_NOT_FOUND', 'No team found for the current user');
    }

    if (!ALLOWED_STATUSES.has(team.status)) {
        throw new AssetError(
            'NOT_REGISTERED',
            `Team status "${team.status}" does not permit asset access`,
        );
    }

    const storagePath = buildAssetPath(fileName);
    const expiresIn = DEFAULT_EXPIRES_IN;

    const { data, error } = await deps.storage.createSignedDownloadUrl(storagePath, expiresIn);

    if (error || !data) {
        const message = error?.message ?? 'unknown error';
        const isNotFound = message.toLowerCase().includes('not found')
            || message.toLowerCase().includes('nosuchkey')
            || message.toLowerCase().includes('404');

        throw new AssetError(
            isNotFound ? 'ASSET_NOT_FOUND' : 'SIGNED_URL_FAILED',
            `Failed to generate download URL: ${message}`,
        );
    }

    return {
        signedUrl: data.signedUrl,
        fileName,
        expiresIn,
    };
}

export function buildAssetPath(fileName: string): string {
    return `${ASSET_PREFIX}/${fileName}`;
}

export function validateFileName(fileName: string): void {
    if (!fileName || fileName.length === 0) {
        throw new AssetError('INVALID_FILENAME', 'Filename must not be empty');
    }

    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        throw new AssetError('INVALID_FILENAME', 'Filename must not contain path traversal characters');
    }

    if (!/^[a-zA-Z0-9\-_.]+$/.test(fileName)) {
        throw new AssetError('INVALID_FILENAME', 'Filename contains invalid characters');
    }
}
