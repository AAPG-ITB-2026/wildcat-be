import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config({ path: './dev.vars' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',   // required for ESM + postgres driver compatibility
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
