import { defineConfig } from '@playwright/test';

const defaultApiBaseUrl = 'https://onze-organizador-de-pelada.onrender.com';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  timeout: 90_000,
  reporter: [['line'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.API_BASE_URL ?? defaultApiBaseUrl,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },
});
