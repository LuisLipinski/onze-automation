import { expect, test } from '@playwright/test';

test.describe('API health', () => {
  test('deve responder UP', async ({ request }) => {
    const response = await request.get('/actuator/health/readiness');

    expect(response.ok()).toBeTruthy();
    await expect(response).toBeOK();

    const body = await response.json();
    expect(body.status).toBe('UP');
  });
});
