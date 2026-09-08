import { expect, test } from '@playwright/test';

test.describe('API authentication', () => {
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

  test('deve responder de forma genérica ao solicitar recuperação de senha', async ({ request }) => {
    const response = await request.post('/api/auth/password-reset/request', {
      data: { email: `missing-${Date.now()}@onze.test` },
    });

    expect(response.status()).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Se existir uma conta com este e-mail, enviaremos um código de recuperação.',
    });
  });

  test('deve rejeitar código de recuperação inválido sem revelar a conta', async ({ request }) => {
    const response = await request.post('/api/auth/password-reset/confirm', {
      data: {
        email: `missing-${Date.now()}@onze.test`,
        code: '000000',
        newPassword: 'NovaSenha123!',
      },
    });

    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_OR_EXPIRED_RESET_CODE',
    });
  });
});
