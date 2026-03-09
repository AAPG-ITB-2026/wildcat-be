import type { DocumentType } from './upload.schema.js';

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
        expiresIn?: number
    ): Promise<StorageResult<string>>;

    listFiles(
        folder: string,
        search?: string,
    ): Promise<StorageResult<{ name: string }[]>>;

    headFile(
        path: string,
    ): Promise<StorageResult<{ contentType: string; contentLength: number }>>;

    getPublicUrl(path: string): string;
}

export interface AdministrationRecord {
    teamId: string;
    leadKtm: string | null;
    m1Ktm: string | null;
    m2Ktm: string | null;
    twibbonProof: string | null;
    posterProof: string | null;
    verificationStatus: 'Pending' | 'Verified' | 'Rejected';
}

export interface AdministrationRepository {
    upsertField(
        teamId: string,
        field: DocumentType,
        filePath: string,
    ): Promise<AdministrationRecord>;

    getField(
        teamId: string,
        field: DocumentType,
    ): Promise<string | null>;
}

export interface TeamRepository {
    findById(id: string): Promise<{ id: string } | null>;
}

export interface UploadServiceDeps {
    storage: StorageClient;
    administration: AdministrationRepository;
    teams: TeamRepository;
}

export interface SignedUploadResult {
    signedUrl: string;
    path: string;
}

export interface ConfirmUploadResult {
    administration: AdministrationRecord;
}

export interface GetDocumentResult {
    signedUrl: string;
    contentType: string;
}
