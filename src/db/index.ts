import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL!;

// Disable prefetch/warmup in dev to prevent hanging connections
// In Prod, the pool will manage itself.
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client);