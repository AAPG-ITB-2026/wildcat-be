import type { Context } from 'hono';
import { confirmUploadSchema, signUploadSchema } from './upload.schema';
import { confirmUpload, generateSignedUploadUrl } from './upload.service';

export async function handleSignUpload(c: Context) {
  const body = await c.req.json().catch(() => null);
  const parsed = signUploadSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid request body' }, 400);
  }

  try {
    const result = await generateSignedUploadUrl(parsed.data);
    return c.json({ success: true, data: result });
  } catch (error) {
    // TODO: Map known errors to structured responses.
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
}

export async function handleConfirmUpload(c: Context) {
  const body = await c.req.json().catch(() => null);
  const parsed = confirmUploadSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ success: false, error: 'Invalid request body' }, 400);
  }

  try {
    // TODO: Read authenticated user id from context after auth middleware.
    const result = await confirmUpload({ ...parsed.data, userId: 'TODO' });
    return c.json({ success: true, data: result });
  } catch (error) {
    // TODO: Map known errors to structured responses.
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: message }, 500);
  }
}
