import type { User } from '@supabase/supabase-js';
import type { InferSelectModel } from 'drizzle-orm';
import type { committeeAccounts } from '../db/schema.js';


export type Env = {
    HYPERDRIVE: Hyperdrive;

    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;


    R2_ACCOUNT_ID: string;
    R2_ACCESS_KEY_ID: string;
    R2_SECRET_ACCESS_KEY: string;
    R2_BUCKET_NAME: string;
    R2_PUBLIC_URL: string;

    DATABASE_URL: string;
};

export type Variables = {
    user: User;
    committee: InferSelectModel<typeof committeeAccounts>;
};