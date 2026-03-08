import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('Missing DATABASE_URL in .env');

const client = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(client);

await migrate(db, { migrationsFolder: './drizzle' });
console.log('Migration complete');

await client.end();
