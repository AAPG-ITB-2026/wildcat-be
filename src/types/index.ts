import type { User } from '@supabase/supabase-js';

// Cloudflare Workers environment bindings (from .dev.vars / wrangler secrets)
export type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  DATABASE_URL: string;
  // Mayar Payment Gateway
  MAYAR_API_KEY: string;
  MAYAR_MERCHANT_ID: string;
  // Legacy Midtrans (for backwards compatibility during migration)
  MIDTRANS_SERVER_KEY?: string;
};

export type Variables = {
  user: User; // Injects the Supabase User type into Hono's context
};
