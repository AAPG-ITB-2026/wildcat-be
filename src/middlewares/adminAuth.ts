import type { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb } from '../db/index.js';
import { committeeAccounts } from '../db/schema.js';
import type { Env, Variables } from '../types/index.js';

export const adminMiddleware = async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const user = c.get('user');
    const db = createDb(c.env);

    // Verify the user exists in the committee table
    const [committee] = await db
        .select({ role: committeeAccounts.role, isActive: committeeAccounts.isActive })
        .from(committeeAccounts)
        .where(eq(committeeAccounts.id, user.id))
        .limit(1);

    // Console log for debugging
    console.log('[adminMiddleware]', {
        uid: user.id,
        role: committee?.role ?? 'N/A',
        foundInTable: !!committee,
    });

    if (!committee || !committee.isActive) {
        return c.json({ error: 'Forbidden: Requires active committee access' }, 403);
    }

    await next();
};