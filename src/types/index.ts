import type { User } from '@supabase/supabase-js';

// Cloudflare Workers environment bindings (from .dev.vars / wrangler secrets)
export type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  DATABASE_URL: string;
};

export type Variables = {
  user: User; // Injects the Supabase User type into Hono's context
};