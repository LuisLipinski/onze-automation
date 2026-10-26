import { defineConfig } from '@playwright/test';

// Playwright supplies fixtures, assertions and reports; every UI command goes to
// UiAutomator2 on an Android emulator. No browser/page or mocked React tree.
export default defineConfig({
  testDir: './frontend',
  testMatch: '**/*.spec.ts',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  workers: 1,
  retries: 0,
  maxFailures: process.env.CI ? 1 : undefined,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  outputDir: 'frontend-results',
  reporter: [
    ['line'],
    ['html', { outputFolder: 'frontend-report', open: 'never' }],
    ['./frontend/support/reporter.ts'],
  ],
  use: {
    baseURL: 'http://127.0.0.1:8080',
    extraHTTPHeaders: { Accept: 'application/json' },
  },
});
