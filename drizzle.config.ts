import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  // Point to your schema file
  schema: './src/db/schema.ts',
  
  // Where to save the generated SQL migration files
  out: './drizzle',
  
  // The database driver you are using
  dialect: 'postgresql',
  
  // Connection string from your .env file
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});