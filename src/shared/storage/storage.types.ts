export interface StorageResult<T> {
    data: T | null;
    error: Error | null;
}

export interface StorageClient {
    createSignedUploadUrl(
        path: string,
        options?: { contentType?: string },
    ): Promise<StorageResult<{ signedUrl: string; path: string }>>;

    createSignedDownloadUrl(
        path: string,
    ): Promise<StorageResult<{ signedUrl: string; path: string }>>;

    listFiles(
        folder: string,
        search?: string,
    ): Promise<StorageResult<{ name: string }[]>>;

    headFile(
        path: string,
    ): Promise<StorageResult<{ contentType: string; contentLength: number }>>;

    getPublicUrl(path: string): string;
}
