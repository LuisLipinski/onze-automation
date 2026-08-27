import { expect, test } from '@playwright/test';

const apiBaseUrl = process.env.API_BASE_URL;

test.describe('API authentication', () => {
  test.skip(!apiBaseUrl, 'API_BASE_URL ainda não configurada para o ambiente de CI.');

  test('deve cadastrar, autenticar e consultar o usuário logado', async ({ request }) => {
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const email = `qa-${unique}@onze.test`;
    const password = 'OnzeTest123!';
    const displayName = 'QA Onze';

    const registerResponse = await request.post('/api/auth/register', {
      data: { email, password, displayName },
    });
    expect(registerResponse.status()).toBe(201);

    const registerBody = await registerResponse.json();
    expect(registerBody.accessToken).toBeTruthy();
    expect(registerBody.tokenType).toBe('Bearer');
    expect(registerBody.user.email).toBe(email);
    expect(registerBody.user.displayName).toBe(displayName);

    const duplicateResponse = await request.post('/api/auth/register', {
      data: { email, password, displayName },
    });
    expect(duplicateResponse.status()).toBe(409);

    const invalidLoginResponse = await request.post('/api/auth/login', {
      data: { email, password: 'senha-errada' },
    });
    expect(invalidLoginResponse.status()).toBe(401);

    const loginResponse = await request.post('/api/auth/login', {
      data: { email, password },
    });
    expect(loginResponse.status()).toBe(200);

    const loginBody = await loginResponse.json();
    expect(loginBody.accessToken).toBeTruthy();

    const meResponse = await request.get('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${loginBody.accessToken}`,
      },
    });
    expect(meResponse.status()).toBe(200);

    const meBody = await meResponse.json();
    expect(meBody.email).toBe(email);
    expect(meBody.displayName).toBe(displayName);
  });
});
