import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import type { Env } from '../types/index.js';

export const createDb = (env: Env) => {
    if (!env.HYPERDRIVE || !env.HYPERDRIVE.connectionString) {
        throw new Error(
            'HYPERDRIVE binding is not configured. Please define a `HYPERDRIVE` Hyperdrive binding with a valid `connectionString` in wrangler.toml.'
        );
    }

    // Create a fresh client per request. Hyperdrive handles the real connection
    // pool externally, so this is just a lightweight logical connection.
    // Do NOT cache this across requests — the underlying TCP connection gets
    // closed by idle_timeout and will cause "Failed query" errors on reuse.
    const client = postgres(env.HYPERDRIVE.connectionString, {
        prepare: false, // Required for Hyperdrive
        max: 1,
    });

    return drizzle(client);
};