import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@contracts': fileURLToPath(new URL('./src/contracts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: { enabled: false },
    // Perf-gate tests measure wall-clock ms; parallel file execution makes
    // them flaky by contention (a regression and a busy scheduler look
    // identical). Sequential costs ~4s extra and buys deterministic gates.
    fileParallelism: false,
  },
});
