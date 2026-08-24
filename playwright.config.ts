import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4173/understory/',
  },
  webServer: {
    command: 'pnpm preview',
    url: 'http://localhost:4173/understory/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
