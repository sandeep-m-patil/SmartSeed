import { defineConfig } from 'vitest/config';

// Opt-in performance smoke tests: `npm run perf`. Not part of the default suite.
export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/globalSetup.ts'],
    include: ['tests/perf/**/*.perf.ts'],
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
