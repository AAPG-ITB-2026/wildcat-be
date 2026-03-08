import type { User } from '@supabase/supabase-js';
import type { InferSelectModel } from 'drizzle-orm';
import type { committeeAccounts } from '../db/schema.js';

// Cloudflare Workers environment bindings (from wrangler.toml / wrangler secrets)
export type Env = {
    // Hyperdrive (managed connection pooler — type provided by @cloudflare/workers-types)
    HYPERDRIVE: Hyperdrive;

    // Supabase Auth
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;

    // R2 Storage
    R2_ACCOUNT_ID: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_BUCKET_NAME: string;
    R2_PUBLIC_URL: string;
    PUBLIC_ASSET_URL: string;

    // Legacy — still used by drizzle-kit migrations via .env
    DATABASE_URL: string;
};

export type Variables = {
  user: User; // Injects the Supabase User type into Hono's context
  committee: InferSelectModel<typeof committeeAccounts>; // Set by committeeMiddleware
};