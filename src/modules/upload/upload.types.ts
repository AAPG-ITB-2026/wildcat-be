export interface StorageResult<T> {
    data: T | null;
    error: Error | null;
}

export interface StorageClient {
    createSignedUploadUrl(
        path: string,
        options?: { upsert?: boolean },
    ): Promise<StorageResult<{ signedUrl: string; path: string; token: string }>>;

    listFiles(
        folder: string,
        search?: string,
    ): Promise<StorageResult<{ name: string }[]>>;

    getPublicUrl(path: string): string;
}

export interface DocumentRecord {
    id: string;
    teamId: string;
    fileUrl: string;
    isVerified: boolean;
    createdAt: Date | null;
}

export interface DocumentRepository {
    insert(data: {
        teamId: string;
        fileUrl: string;
        isVerified: boolean;
    }): Promise<DocumentRecord>;
}

export interface TeamRepository {
    findById(id: string): Promise<{ id: string } | null>;
}

export interface UploadServiceDeps {
    storage: StorageClient;
    documents: DocumentRepository;
    teams: TeamRepository;
}

export interface SignedUploadResult {
    signedUrl: string;
    path: string;
    token: string;
}

export interface ConfirmUploadResult {
    document: DocumentRecord;
}
