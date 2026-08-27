import { expect, test } from '@playwright/test';

const apiBaseUrl = process.env.API_BASE_URL;

test.describe('API health', () => {
  test.skip(!apiBaseUrl, 'API_BASE_URL ainda não configurada para o ambiente de CI.');

  test('deve responder UP', async ({ request }) => {
    const response = await request.get('/actuator/health');

    expect(response.ok()).toBeTruthy();
    await expect(response).toBeOK();

    const body = await response.json();
    expect(body.status).toBe('UP');
  });
});
