import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/globalSetup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // Process entrypoints only wire configuration to tested modules; they need a live stack (Docker/Fabric) to run.
      exclude: ['src/server.ts', 'src/worker.ts', 'src/**/*.d.ts'],
      thresholds: { lines: 80, branches: 75 },
    },
  },
});
