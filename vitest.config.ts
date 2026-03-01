import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    alias: [{ find: /^(.*)\.js$/, replacement: '$1' }],
  },
});
