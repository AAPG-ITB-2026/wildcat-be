import type { User } from '@supabase/supabase-js';

export type Variables = {
  user: User; // Injects the Supabase User type into Hono's context
};