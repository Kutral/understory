import { defineConfig } from '@playwright/test';

/**
 * Preview port is overridable so parallel qa agents can each serve their own
 * worktree build without fighting over the shared 4173 instance:
 *   E2E_PREVIEW_PORT=4174 node <main>/node_modules/@playwright/test/cli.js test ...
 * Default stays 4173.
 */
const PORT = process.env.E2E_PREVIEW_PORT ?? '4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${PORT}/understory/`,
  },
  webServer: {
    command: 'pnpm preview',
    url: `http://localhost:${PORT}/understory/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
