import type { RequestPaymentUrlInput, SubmitPaymentProofInput } from './transaction.schema.js';
import type {
    TransactionServiceDeps,
    SignedPaymentUrlResult,
    SubmitPaymentProofResult,
} from './transaction.types.js';
import { TransactionError } from './transaction.errors.js';

/** Max payment receipt size: 2 MB (per ticket requirement) */
const PAYMENT_MAX_SIZE_BYTES = 2 * 1024 * 1024;

const PAYMENT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Presigned URL Generation
// POST /api/transactions/request-url
// ─────────────────────────────────────────────────────────────────────────────
export async function generatePaymentSignedUrl(
    input: RequestPaymentUrlInput,
    teamId: string,
    deps: TransactionServiceDeps,
): Promise<SignedPaymentUrlResult> {
    const { storage, teams } = deps;

    // Verify team exists
    const team = await teams.findTeamWithCompetition(teamId);
    if (!team) {
        throw new TransactionError('TEAM_NOT_FOUND', `Team ${teamId} does not exist`);
    }

    // R2 path: <teamId>/payment_proof_<filename>
    const storagePath = `${teamId}/payment_proof_${input.filename}`;

    const { data, error } = await storage.createSignedUploadUrl(storagePath, {
        contentType: input.content_type,
    });

    if (error || !data) {
        throw new TransactionError(
            'SIGNED_URL_FAILED',
            `Failed to create signed upload URL: ${error?.message ?? 'unknown error'}`,
        );
    }

    return {
        signedUrl: data.signedUrl,
        path: data.path,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Submit Payment Proof
// POST /api/transactions/submit-proof
// ─────────────────────────────────────────────────────────────────────────────
export async function submitPaymentProof(
    input: SubmitPaymentProofInput,
    teamId: string,
    deps: TransactionServiceDeps,
): Promise<SubmitPaymentProofResult> {
    const { storage, transactions, teams } = deps;

    // 1. Verify team + competition
    const team = await teams.findTeamWithCompetition(teamId);
    if (!team) {
        throw new TransactionError('TEAM_NOT_FOUND', `Team ${teamId} does not exist`);
    }

    // 2. Verify the uploaded file actually exists in R2
    const r2Key = extractR2Key(input.file_url);

    if (r2Key) {
        const { data: fileMeta, error } = await storage.headFile(r2Key);
        if (error || !fileMeta) {
            throw new TransactionError('FILE_NOT_FOUND', `No file found at URL: ${input.file_url}`);
        }

        // Enforce 2 MB limit
        if (fileMeta.contentLength > PAYMENT_MAX_SIZE_BYTES) {
            throw new TransactionError(
                'FILE_TOO_LARGE',
                `File is too large: ${(fileMeta.contentLength / 1024 / 1024).toFixed(2)}MB. Max allowed is 2MB.`,
            );
        }

        // Enforce content type
        if (!PAYMENT_ALLOWED_TYPES.includes(fileMeta.contentType)) {
            throw new TransactionError(
                'INVALID_CONTENT_TYPE',
                `File has content-type '${fileMeta.contentType}', allowed: ${PAYMENT_ALLOWED_TYPES.join(', ')}`,
            );
        }
    }

    // 3. Compute amount from competition fee (early bird vs normal)
    const now = new Date();
    const isEarlyBird = now <= team.earlyBirdDeadline;
    const amount = isEarlyBird ? team.earlyBirdFee : team.normalBirdFee;

    // 4. Generate orderId for manual payment (only used when creating new row)
    const orderId = `MANUAL-${teamId.substring(0, 8)}-${Date.now()}`;

    // 5. Upsert transaction
    const transaction = await transactions.upsertPaymentProof(
        teamId,
        input.file_url,
        input.payment_method,
        amount,
        orderId,
    );

    return { transaction };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extracts the R2 object key from various URL formats.
 * Strips the bucket prefix (wildcat2026/) when present.
 */
function extractR2Key(fileUrl: string): string | null {
    try {
        // Relative path with bucket prefix
        if (fileUrl.startsWith('wildcat2026/')) {
            return fileUrl.substring('wildcat2026/'.length);
        }

        // Absolute URL — extract path portion
        if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
            const url = new URL(fileUrl);
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts[0] === 'wildcat2026') {
                return parts.slice(1).join('/');
            }
            return parts.join('/');
        }

        // Treat as direct R2 key
        return fileUrl;
    } catch {
        return null;
    }
}
