import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import type { Env } from '../types/index.js';

export const createDb = (env: Env) => {
  const client = postgres(env.DATABASE_URL, { prepare: false });
  return drizzle(client, { schema });
};