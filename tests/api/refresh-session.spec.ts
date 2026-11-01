import { test, expect } from '../support/test';
import { auth, body, password, register } from '../support/factory';

const day = 86400_000;

test('refresh renova JWT vencido e replay revoga a credencial substituta', async ({ request, control }) => {
  const actor = await register(request);
  expect(actor.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await control.advanceAuth(3 * 3600_000);
  expect((await request.get('/api/auth/me', { headers: auth(actor) })).status()).toBe(401);
  const next = await body(await request.post('/api/auth/refresh', { data: { refreshToken: actor.refreshToken } }));
  expect(next.user.id).toBe(actor.user.id);
  expect(next.accessToken).not.toBe(actor.accessToken);
  expect(next.refreshToken).not.toBe(actor.refreshToken);
  expect((await request.get('/api/auth/me', { headers: auth(next) })).status()).toBe(200);
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: actor.refreshToken } })).status()).toBe(401);
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: next.refreshToken } })).status()).toBe(401);
});

test('logout revoga uma sessão e preserva outro login da mesma conta', async ({ request }) => {
  const actor = await register(request);
  const other = await body(await request.post('/api/auth/login', { data: { email: actor.user.email, password } }));
  for (let call = 0; call < 2; call++) {
    expect((await request.post('/api/auth/logout', { data: { refreshToken: actor.refreshToken } })).status()).toBe(204);
  }
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: actor.refreshToken } })).status()).toBe(401);
  const next = await body(await request.post('/api/auth/refresh', { data: { refreshToken: other.refreshToken } }));
  expect(next.user.id).toBe(actor.user.id);
});

test('renovação respeita inatividade de 30 dias e limite absoluto de 90 dias', async ({ request, control }) => {
  const actor = await register(request);
  await control.advanceAuth(30 * day);
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: actor.refreshToken } })).status()).toBe(401);
  let active = await body(await request.post('/api/auth/login', { data: { email: actor.user.email, password } }));
  for (let cycle = 0; cycle < 4; cycle++) {
    await control.advanceAuth(20 * day);
    active = await body(await request.post('/api/auth/refresh', { data: { refreshToken: active.refreshToken } }));
  }
  expect(active.refreshExpiresIn).toBe(10 * 86400);
  await control.advanceAuth(10 * day);
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: active.refreshToken } })).status()).toBe(401);
});

test('redefinição da senha encerra as credenciais de renovação anteriores', async ({ request, control }) => {
  const actor = await register(request);
  await body(await request.post('/api/auth/password-reset/request', { data: { email: actor.user.email } }), 202);
  const emails = await control.call('/emails');
  expect(emails).toHaveLength(1);
  await body(await request.post('/api/auth/password-reset/confirm', {
    data: { email: actor.user.email, code: emails[0].code, newPassword: 'NovaSenha123!' },
  }));
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: actor.refreshToken } })).status()).toBe(401);
  const next = await body(await request.post('/api/auth/login', { data: { email: actor.user.email, password: 'NovaSenha123!' } }));
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: next.refreshToken } })).status()).toBe(200);
});

test('instalação legada troca uma vez JWT válido e continua após expiração do acesso', async ({ request, control }) => {
  const actor = await register(request);
  const old = await control.call('/legacy-access', { userId: actor.user.id });
  const headers = { Authorization: `Bearer ${old.accessToken}` };
  const next = await body(await request.post('/api/auth/sessions/legacy', { headers }));
  expect(next.user.id).toBe(actor.user.id);
  expect((await request.post('/api/auth/sessions/legacy', { headers })).status()).toBe(401);
  expect((await request.post('/api/auth/sessions/legacy', { headers: auth(next) })).status()).toBe(401);
  await control.advanceAuth(3 * 3600_000);
  expect((await request.post('/api/auth/sessions/legacy', { headers })).status()).toBe(401);
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: next.refreshToken } })).status()).toBe(200);
});

test('segredos ausentes, inválidos e desconhecidos não criam sessão', async ({ request }) => {
  for (const data of [{}, { refreshToken: 'invalid' }]) {
    expect((await request.post('/api/auth/refresh', { data })).status()).toBe(400);
  }
  expect((await request.post('/api/auth/refresh', { data: { refreshToken: 'z'.repeat(43) } })).status()).toBe(401);
  expect((await request.post('/api/auth/logout', { data: { refreshToken: 'z'.repeat(43) } })).status()).toBe(204);
  expect((await request.post('/api/auth/sessions/legacy')).status()).toBe(401);
});
