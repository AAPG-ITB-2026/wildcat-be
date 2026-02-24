import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Env } from '../types/index.js';

/**
 * Creates a Drizzle client per-request via Hyperdrive.
 *
 * Hyperdrive maintains the underlying connection pool,
 * so creating a new client per request is fast and recommended.
 * @see https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/
 */
export const createDb = (env: Env) => {
    const client = postgres(env.HYPERDRIVE.connectionString, {
        prepare: false, // required for Hyperdrive transaction-mode pooling
        max: 5,         // Workers limit on concurrent external connections
    });
    return drizzle(client);
};