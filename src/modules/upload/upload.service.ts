import type { ConfirmUploadInput, SignUploadInput } from './upload.schema';

export type SignedUploadResult = {
  signedUrl: string;
  path: string;
  token: string;
};

export type ConfirmUploadResult = {
  documentId: string;
};

export async function generateSignedUploadUrl(
  input: SignUploadInput
): Promise<SignedUploadResult> {
  // TODO: Build storage path with {teamId}/{documentType}/{timestamp}_{fileName}.
  // TODO: Use a Supabase admin client with createSignedUploadUrl() and 60s expiry.
  // TODO: Return { signedUrl, path, token } on success.
  throw new Error('Not implemented');
}

export async function confirmUpload(
  input: ConfirmUploadInput & { userId: string }
): Promise<ConfirmUploadResult> {
  // TODO: Verify team ownership for input.teamId and input.userId.
  // TODO: Insert into documents table using Drizzle ORM.
  // TODO: Return the created document record or id.
  throw new Error('Not implemented');
}
