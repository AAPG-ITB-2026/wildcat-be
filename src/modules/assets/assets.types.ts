export interface StorageResult<T> {
    data: T | null;
    error: Error | null;
}

export interface AssetStorageClient {
    createSignedDownloadUrl(
        path: string,
        expiresIn?: number,
    ): Promise<StorageResult<{ signedUrl: string }>>;
}

export interface AssetTeamRepository {
    findByUserId(userId: string): Promise<{ id: string; status: string } | null>;
}

export interface AssetServiceDeps {
    storage: AssetStorageClient;
    teams: AssetTeamRepository;
}

export interface AssetDownloadResult {
    signedUrl: string;
    fileName: string;
    expiresIn: number;
}
