import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    // Vitest handles ESM natively; alias .js imports to their .ts source
    // so TypeScript paths like '../../lib/supabase.js' resolve correctly.
    alias: [{ find: /^(.*)\.js$/, replacement: '$1' }],
  },
});
