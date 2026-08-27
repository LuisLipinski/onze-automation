import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['line'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.API_BASE_URL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },
});
