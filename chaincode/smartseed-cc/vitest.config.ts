import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    silent: true, // fabric-contract-api logs every decorator at import time
    coverage: { provider: 'v8', include: ['src/**/*.ts'], thresholds: { lines: 80, branches: 75 } },
  },
});
