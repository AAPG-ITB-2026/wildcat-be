import type { Context, Next } from 'hono';
import { eq } from 'drizzle-orm';
import { createSupabaseClient } from '../lib/supabase.js';
import { createDb } from '../db/index.js';
import { committeeAccounts } from '../db/schema.js';
import type { Env, Variables } from '../types/index.js';

export const authMiddleware = async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Missing or invalid token' }, 401);
  }

  const token = authHeader.split(' ')[1];

  const supabase = createSupabaseClient(c.env);

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return c.json({ error: 'Unauthorized: Invalid or expired token' }, 401);
  }

  c.set('user', user);

  await next();
};

// ─────────────────────────────────────────────────────────────────────────────
// committeeMiddleware({ roles?, divisions? })
// Validates the authenticated user is an active committee member and
// optionally restricts access by role ("Admin"|"Committee") and/or division.
// When BOTH roles and divisions are provided, access is granted if the member
// satisfies the role check OR the division check (i.e. union, not intersection).
//
// Usage examples:
//   committeeMiddleware()                                           → any active committee member
//   committeeMiddleware({ roles: ['Admin'] })                      → Admin only
//   committeeMiddleware({ roles: ['Admin'], divisions: ['Event'] }) → Admin role OR Event division
// ─────────────────────────────────────────────────────────────────────────────
export const committeeMiddleware = (opts?: {
  roles?: Array<'Admin' | 'Committee'>;
  divisions?: string[];
}) => {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    const user = c.get('user');

    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const db = createDb(c.env);

    const [member] = await db
      .select()
      .from(committeeAccounts)
      .where(eq(committeeAccounts.id, user.id))
      .limit(1);

    if (!member || !member.isActive) {
      return c.json({ error: 'Forbidden: Not an active committee member' }, 403);
    }

    const hasRoles = opts?.roles && opts.roles.length > 0;
    const hasDivisions = opts?.divisions && opts.divisions.length > 0;

    if (hasRoles || hasDivisions) {
      const roleOk = hasRoles ? opts!.roles!.includes(member.role) : false;
      const divisionOk = hasDivisions
        ? opts!.divisions!.map((d) => d.toLowerCase()).includes(member.division.toLowerCase())
        : false;

      // Grant access if member passes EITHER the role check OR the division check
      if (!roleOk && !divisionOk) {
        return c.json({ error: 'Forbidden: Insufficient role or division' }, 403);
      }
    }

    c.set('committee', member);

    await next();
  };
};