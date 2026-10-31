import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['line'], ['html', { open: 'never' }], ['./tests/support/coverage-reporter.ts']],
  use: {
    baseURL: process.env.API_BASE_URL ?? 'http://127.0.0.1:8080',
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },
  projects: [
    { name: 'backend', testIgnore: '**/devtools-enabled.spec.ts', metadata: { controlURL: 'http://127.0.0.1:8090' } },
    { name: 'devtools-enabled', testMatch: '**/devtools-enabled.spec.ts', use: { baseURL: 'http://127.0.0.1:8081' }, metadata: { controlURL: 'http://127.0.0.1:8091' } },
  ],
});
