import type {
    AdminReviewPagination,
    AdminReviewServiceDeps,
    SignedFileView,
} from './admin.types.js';

async function toSignedFileView(
    fileReference: string | null,
    deps: AdminReviewServiceDeps,
): Promise<SignedFileView> {
    const objectKey = resolveObjectKeyFromReference(fileReference);

    if (!objectKey) {
        return {
            originalFileRef: fileReference,
            objectKey: null,
            downloadUrl: null,
        };
    }

    const { data, error } = await deps.storage.createSignedDownloadUrl(objectKey);
    if (error || !data) {
        console.error('[admin-review] Signed URL generation failed', {
            objectKey,
            error: error?.message ?? 'unknown error',
        });

        return {
            originalFileRef: fileReference,
            objectKey,
            downloadUrl: null,
        };
    }

    return {
        originalFileRef: fileReference,
        objectKey,
        downloadUrl: data.signedUrl,
    };
}

export async function listPaymentVerificationReviews(
    deps: AdminReviewServiceDeps,
    pagination: AdminReviewPagination,
) {
    const rows = await deps.reviews.listTransactions(pagination);

    return Promise.all(
        rows.map(async (row) => ({
            transactionId: row.transactionId,
            team: {
                id: row.teamId,
                name: row.teamName,
                institution: row.institution,
            },
            orderId: row.orderId,
            amount: row.amount,
            paymentType: row.paymentType,
            verificationStatus: row.verificationStatus,
            verifiedBy: row.verifiedBy,
            rejectionNotes: row.rejectionNotes,
            createdAt: row.createdAt,
            paymentProof: await toSignedFileView(row.paymentProofRef, deps),
        })),
    );
}

export async function listAdministrationVerificationReviews(
    deps: AdminReviewServiceDeps,
    pagination: AdminReviewPagination,
) {
    const rows = await deps.reviews.listAdministrationDocuments(pagination);

    return Promise.all(
        rows.map(async (row) => {
            const [leadKtm, twibbonProof, posterProof] = await Promise.all([
                toSignedFileView(row.leadKtmRef, deps),
                toSignedFileView(row.twibbonProofRef, deps),
                toSignedFileView(row.posterProofRef, deps),
            ]);

            return {
                team: {
                    id: row.teamId,
                    name: row.teamName,
                    institution: row.institution,
                },
                verificationStatus: row.verificationStatus,
                verifiedBy: row.verifiedBy,
                rejectionNotes: row.rejectionNotes,
                documents: {
                    leadKtm,
                    twibbonProof,
                    posterProof,
                },
            };
        }),
    );
}

export async function listStageSubmissionReviews(
    stageId: string,
    deps: AdminReviewServiceDeps,
    pagination: AdminReviewPagination,
) {
    const rows = await deps.reviews.listStageSubmissions(stageId, pagination);

    return Promise.all(
        rows.map(async (row) => ({
            submissionId: row.submissionId,
            team: {
                id: row.teamId,
                name: row.teamName,
                institution: row.institution,
            },
            requirement: {
                id: row.requirementId,
                documentName: row.documentName,
            },
            isValid: row.isValid,
            verifiedBy: row.verifiedBy,
            submittedAt: row.submittedAt,
            file: await toSignedFileView(row.fileRef, deps),
        })),
    );
}
