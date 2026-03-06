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
        .select({ role: committeeAccounts.role })
        .from(committeeAccounts)
        .where(eq(committeeAccounts.id, user.id))
        .limit(1);

    if (!committee) {
        return c.json({ error: 'Forbidden: Requires committee access' }, 403);
    }

    await next();
};