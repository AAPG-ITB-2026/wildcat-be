import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    listAdministrationVerificationReviews,
    listPaymentVerificationReviews,
    listStageSubmissionReviews,
} from '../admin.service.js';
import type { AdminReviewServiceDeps } from '../admin.types.js';

function createMockDeps(overrides?: Partial<AdminReviewServiceDeps>): AdminReviewServiceDeps {
    return {
        storage: {
            createSignedUploadUrl: vi.fn(),
            createSignedDownloadUrl: vi.fn().mockResolvedValue({
                data: {
                    signedUrl: 'https://r2.example.com/signed-download',
                    path: 'submissions/team-1/req-1/file.pdf',
                },
                error: null,
            }),
            listFiles: vi.fn(),
            headFile: vi.fn(),
            getPublicUrl: vi.fn(),
        },
        reviews: {
            listTransactions: vi.fn().mockResolvedValue([
                {
                    transactionId: 'tx-1',
                    teamId: 'team-1',
                    teamName: 'Alpha',
                    institution: 'Uni A',
                    orderId: 'ORDER-1',
                    amount: '100000.00',
                    paymentType: 'bank_transfer',
                    verificationStatus: 'Pending',
                    verifiedBy: null,
                    rejectionNotes: null,
                    createdAt: new Date('2026-03-07T00:00:00.000Z'),
                    paymentProofRef: 'team-1/payment/receipt.pdf',
                },
            ]),
            listAdministrationDocuments: vi.fn().mockResolvedValue([
                {
                    teamId: 'team-1',
                    teamName: 'Alpha',
                    institution: 'Uni A',
                    verificationStatus: 'Pending',
                    verifiedBy: null,
                    rejectionNotes: null,
                    leadKtmRef: 'team-1/lead_ktm/lead.pdf',
                    twibbonProofRef: null,
                    posterProofRef: 'https://cdn.example.com/team-1/poster_proof/poster.png',
                },
            ]),
            listStageSubmissions: vi.fn().mockResolvedValue([
                {
                    submissionId: 'sub-1',
                    teamId: 'team-1',
                    teamName: 'Alpha',
                    institution: 'Uni A',
                    requirementId: 'req-1',
                    documentName: 'Paper',
                    isValid: false,
                    verifiedBy: null,
                    submittedAt: new Date('2026-03-07T00:00:00.000Z'),
                    fileRef: 'submissions/team-1/req-1/file.pdf',
                },
            ]),
        },
        ...overrides,
    };
}

describe('admin.service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should map transaction list and attach signed payment proof URL', async () => {
        const deps = createMockDeps();

        const result = await listPaymentVerificationReviews(deps, { limit: 20, offset: 0 });

        expect(result).toHaveLength(1);
        expect(result[0]?.team.name).toBe('Alpha');
        expect(result[0]?.paymentProof.downloadUrl).toBe('https://r2.example.com/signed-download');
        expect(deps.reviews.listTransactions).toHaveBeenCalledWith({ limit: 20, offset: 0 });
        expect(deps.storage.createSignedDownloadUrl).toHaveBeenCalledWith('team-1/payment/receipt.pdf');
    });

    it('should keep downloadUrl null when file ref is invalid', async () => {
        const deps = createMockDeps({
            reviews: {
                listTransactions: vi.fn().mockResolvedValue([
                    {
                        transactionId: 'tx-1',
                        teamId: 'team-1',
                        teamName: 'Alpha',
                        institution: 'Uni A',
                        orderId: 'ORDER-1',
                        amount: '100000.00',
                        paymentType: 'bank_transfer',
                        verificationStatus: 'Pending',
                        verifiedBy: null,
                        rejectionNotes: null,
                        createdAt: new Date('2026-03-07T00:00:00.000Z'),
                        paymentProofRef: '../unsafe/path.pdf',
                    },
                ]),
                listAdministrationDocuments: vi.fn().mockResolvedValue([]),
                listStageSubmissions: vi.fn().mockResolvedValue([]),
            },
        });

        const result = await listPaymentVerificationReviews(deps, { limit: 10, offset: 5 });

        expect(result[0]?.paymentProof.downloadUrl).toBeNull();
        expect(deps.reviews.listTransactions).toHaveBeenCalledWith({ limit: 10, offset: 5 });
        expect(deps.storage.createSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('should map administration documents and sign available refs', async () => {
        const deps = createMockDeps();

        const result = await listAdministrationVerificationReviews(deps, { limit: 20, offset: 0 });

        expect(result).toHaveLength(1);
        expect(deps.reviews.listAdministrationDocuments).toHaveBeenCalledWith({ limit: 20, offset: 0 });
        expect(result[0]?.documents.leadKtm.downloadUrl).toBe('https://r2.example.com/signed-download');
        expect(result[0]?.documents.twibbonProof.downloadUrl).toBeNull();
    });

    it('should fetch stage submissions via explicit stage id', async () => {
        const deps = createMockDeps();

        const result = await listStageSubmissionReviews('stage-1', deps, { limit: 15, offset: 30 });

        expect(result).toHaveLength(1);
        expect(deps.reviews.listStageSubmissions).toHaveBeenCalledWith('stage-1', { limit: 15, offset: 30 });
        expect(result[0]?.requirement.documentName).toBe('Paper');
    });
});
