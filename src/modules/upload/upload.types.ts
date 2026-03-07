import type { DocumentType } from './upload.schema.js';
import type { StorageClient } from '../../shared/storage/storage.types.js';

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
        fileUrl: string,
    ): Promise<AdministrationRecord>;
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
