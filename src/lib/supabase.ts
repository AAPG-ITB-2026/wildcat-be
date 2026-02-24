// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import type { Env } from '../types/index.js';


export const createSupabaseClient = (env: Env) => {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
};