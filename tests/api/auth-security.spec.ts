import { test, expect } from '../support/test';
import { register, auth, body, password } from '../support/factory';

test('reset issued code changes password once and invalidates previous credentials', async ({ request, control }) => {
  const user = await register(request);
  const url = '/api/auth/password-reset/request';
  await body(await request.post(url, { data: { email: user.user.email } }), 202);
  const emails = await control.call('/emails');
  expect(emails).toHaveLength(1);
  expect(emails[0].code).toMatch(/^\d{6}$/);
  await body(await request.post(url, { data: { email: user.user.email.toUpperCase() } }), 202);
  expect(await control.call('/emails')).toHaveLength(1);
  const data = { email: user.user.email, code: emails[0].code, newPassword: 'NovaSenha456!' };
  await body(await request.post('/api/auth/password-reset/confirm', { data }));
  expect((await request.post('/api/auth/login', { data: { email: user.user.email, password } })).status()).toBe(401);
  const loggedIn = await body(await request.post('/api/auth/login', { data: { email: user.user.email.toUpperCase(), password: data.newPassword } }));
  expect(loggedIn.user.id).toBe(user.user.id);
  expect((await request.post('/api/auth/password-reset/confirm', { data })).status()).toBe(400);
});

test('expired recovery code is rejected without changing password', async ({ request, control }) => {
  const user = await register(request);
  await body(await request.post('/api/auth/password-reset/request', { data: { email: user.user.email } }), 202);
  const [email] = await control.call('/emails');
  await control.call('/expire-reset-code', { userId: user.user.id });
  expect((await request.post('/api/auth/password-reset/confirm', { data: { email: user.user.email, code: email.code, newPassword: 'NovaSenha456!' } })).status()).toBe(400);
  await body(await request.post('/api/auth/login', { data: { email: user.user.email, password } }));
});

test('five invalid recovery attempts consume code and resend replaces old code', async ({ request, control }) => {
  const user = await register(request);
  await body(await request.post('/api/auth/password-reset/request', { data: { email: user.user.email } }), 202);
  const [first] = await control.call('/emails');
  const wrong = first.code === '000000' ? '000001' : '000000';
  for (let i = 0; i < 5; i++) expect((await request.post('/api/auth/password-reset/confirm', { data: { email: user.user.email, code: wrong, newPassword: 'NovaSenha456!' } })).status()).toBe(400);
  expect((await request.post('/api/auth/password-reset/confirm', { data: { email: user.user.email, code: first.code, newPassword: 'NovaSenha456!' } })).status()).toBe(400);
  await control.call('/allow-reset-resend', { userId: user.user.id });
  await body(await request.post('/api/auth/password-reset/request', { data: { email: user.user.email } }), 202);
  const emails = await control.call('/emails');
  expect(emails).toHaveLength(2);
  await body(await request.post('/api/auth/password-reset/confirm', { data: { email: user.user.email, code: emails[1].code, newPassword: 'NovaSenha456!' } }));
});

test('reset does not reveal account existence or provider failure', async ({ request, control }) => {
  const user = await register(request);
  await control.call('/boundaries', { failEmail: true });
  const known = await request.post('/api/auth/password-reset/request', { data: { email: user.user.email } });
  const unknown = await request.post('/api/auth/password-reset/request', { data: { email: 'unknown@onze.test' } });
  expect(known.status()).toBe(202);
  expect(unknown.status()).toBe(known.status());
  expect(await unknown.json()).toEqual(await known.json());
  expect(await control.call('/emails')).toHaveLength(0);
});

test('persistent login protection blocks correct password after repeated failures', async ({ request, control }) => {
  const user = await register(request);
  for (let i = 0; i < 5; i++) {
    const response = await request.post('/api/auth/login', { data: { email: user.user.email, password: 'wrong' } });
    expect([401, 429]).toContain(response.status());
  }
  const blocked = await request.post('/api/auth/login', { data: { email: user.user.email, password } });
  expect(blocked.status()).toBe(429);
  await control.call('/unlock-login', { userId: user.user.id });
  await body(await request.post('/api/auth/login', { data: { email: user.user.email, password } }));
  await body(await request.post('/api/auth/login', { data: { email: user.user.email, password } }));
});

test('duplicate email is case insensitive and private fields never leave auth endpoints', async ({ request }) => {
  const actor = await register(request);
  expect((await request.post('/api/auth/register', { data: { email: actor.user.email.toUpperCase(), password, displayName: 'Outra conta' } })).status()).toBe(409);
  const me = await body(await request.get('/api/auth/me', { headers: auth(actor) }));
  expect(me).toMatchObject({ id: actor.user.id, email: actor.user.email });
  expect(me).not.toHaveProperty('passwordHash');
  expect(me).not.toHaveProperty('failedLoginAttempts');
  expect((await request.get('/api/auth/me', { headers: { Authorization: 'Bearer invalid.jwt.signature' } })).status()).toBe(401);
});

for (const [name, data] of Object.entries({
  'invalid email': { email: 'invalid', password, displayName: 'QA' },
  'short password': { email: 'valid@onze.test', password: '1234567', displayName: 'QA' },
  'long password': { email: 'valid@onze.test', password: 'a'.repeat(73), displayName: 'QA' },
  'blank name': { email: 'valid@onze.test', password, displayName: '  ' },
})) test(`registration validates ${name}`, async ({ request }) => expect((await request.post('/api/auth/register', { data })).status()).toBe(400));
