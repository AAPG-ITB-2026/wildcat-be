import type { User } from '@supabase/supabase-js';
import type { InferSelectModel } from 'drizzle-orm';
import type { committeeAccounts } from '../db/schema.js';

// Cloudflare Workers environment bindings (from .dev.vars / wrangler secrets)
export type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  DATABASE_URL: string;
};

export type Variables = {
  user: User; // Injects the Supabase User type into Hono's context
  committee: InferSelectModel<typeof committeeAccounts>; // Set by committeeMiddleware
};