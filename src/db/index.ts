import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Env } from '../types/index.js';

// Cache the database connection across requests in the same Worker isolate
let cachedDb: ReturnType<typeof drizzle> | null = null;

export const createDb = (env: Env) => {
    if (cachedDb) {
        return cachedDb;
    }

    if (!env.HYPERDRIVE || !env.HYPERDRIVE.connectionString) {
        throw new Error(
            'HYPERDRIVE binding is not configured. Please define a `HYPERDRIVE` Hyperdrive binding with a valid `connectionString` in wrangler.toml.'
        );
    }

    const client = postgres(env.HYPERDRIVE.connectionString, {
        prepare: false, // Required for Hyperdrive
        max: 1,         // Use 1 connection! Hyperdrive acts as the real pool.
        idle_timeout: 30, // Safely close the connection if the worker goes idle
    });

    cachedDb = drizzle(client);
    return cachedDb;
};