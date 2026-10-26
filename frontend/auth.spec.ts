import { randomUUID } from 'node:crypto';
import { test, expect } from './support/test';
import { auth, body, group, password, register } from '../tests/support/factory';

test('[UI-A01] login inválido mostra erro e mantém formulário', async ({ ui, request }) => {
  const actor = await register(request);
  await ui.screen('index', 'E-mail');
  await ui.fill('E-mail', actor.user.email);
  await ui.fill('Senha', 'SenhaIncorreta123');
  await ui.tap('Entrar');
  await ui.has('E-mail ou senha inválidos.');
  await ui.absent('Home');
});

test('[UI-A02] cadastro pelo Android e login com a conta criada', async ({ ui, request }) => {
  const email = `${randomUUID()}@onze.test`;
  await ui.open('register');
  await ui.screen('register', 'Seu nome');
  await ui.fill('Seu nome', 'Cadastro Android');
  await ui.fill('E-mail', email);
  await ui.fill('Senha (mínimo 8 caracteres)', password);
  await ui.tap('Criar conta');
  await ui.has('Senha');
  await ui.fill('E-mail', email);
  await ui.fill('Senha', password);
  await ui.tap('Entrar');
  await ui.screen('home', 'Olá, Cadastro Android');
  const login = await body(await request.post('/api/auth/login', { data: { email, password } }));
  expect(login.user.displayName).toBe('Cadastro Android');
});

test('[UI-A03] recuperação solicita código e altera senha pela interface', async ({ ui, request, control }) => {
  const actor = await register(request);
  await ui.open('forgot-password');
  await ui.screen('forgot-password', 'Esqueci minha senha');
  await ui.fill('E-mail', actor.user.email);
  await ui.tap('Enviar código');
  await ui.screen('reset-password', 'Criar nova senha');
  const messages = await control.call('/emails');
  expect(messages).toHaveLength(1);
  await ui.fill('Código de 6 dígitos', messages[0].code);
  await ui.fill('Nova senha (mínimo 8 caracteres)', 'NovaSenha123!');
  await ui.tap('Alterar senha');
  await ui.has('Senha');
  await ui.fill('E-mail', actor.user.email);
  await ui.fill('Senha', 'NovaSenha123!');
  await ui.tap('Entrar');
  await ui.has(`Olá, ${actor.user.displayName}`);
  expect((await request.post('/api/auth/login', { data: { email: actor.user.email, password } })).status()).toBe(401);
});

test('[UI-A04] recuperação recusa código incorreto sem alterar senha', async ({ ui, request }) => {
  const actor = await register(request);
  await body(await request.post('/api/auth/password-reset/request', { data: { email: actor.user.email } }));
  await ui.open('reset-password', { email: actor.user.email });
  await ui.fill('Código de 6 dígitos', '000000');
  await ui.fill('Nova senha (mínimo 8 caracteres)', 'NovaSenha123!');
  await ui.tap('Alterar senha');
  await ui.has('Código inválido ou expirado. Solicite um novo código.');
  expect((await request.post('/api/auth/login', { data: { email: actor.user.email, password } })).status()).toBe(200);
});

test('[UI-A05] sessão persiste ao reabrir e logout volta ao login', async ({ ui, request }) => {
  const actor = await register(request);
  await ui.login(actor);
  await ui.execute('mobile: terminateApp', { appId: 'com.onze.organizadordepelada' });
  await ui.execute('mobile: activateApp', { appId: 'com.onze.organizadordepelada' });
  await ui.has(`Olá, ${actor.user.displayName}`);
  await ui.tap('Configurações');
  await ui.screen('settings', 'Sua conta');
  await ui.tabs();
  await ui.sees('Login com biometria');
  await ui.tap('Sair da conta');
  await ui.has('Senha');
  await ui.absent('Home');
});

test('[UI-A06] tabs navegam e voltam ao grupo sem perder sessão', async ({ ui, request }) => {
  const g = await group(request, 0);
  await ui.login(g.owner);
  await ui.tap('Grupos');
  await ui.screen('groups', 'Grupo automação');
  await ui.tap('Grupo automação');
  await ui.screen('group', 'Grupo automação');
  await ui.tabs();
  await ui.tap('Configurações');
  await ui.has('Sua conta');
  await ui.tap('Home');
  await ui.has(`Olá, ${g.owner.user.displayName}`);
});

test('[UI-A07] convite profundo exige autenticação e preserva código', async ({ ui, request }) => {
  const g = await group(request, 0);
  const newcomer = await register(request, 'Convidado Android');
  await ui.open(`join/${g.invitation.code}`);
  await ui.screen('join/[code]', 'Entrar em um grupo');
  await ui.tap('Entrar no grupo');
  await ui.has('Senha');
  await ui.signIn(newcomer);
  await ui.sees('Entrar no grupo');
  await ui.tap('Entrar no grupo');
  await ui.has('Preencher perfil esportivo');
  const memberships = await body(await request.get('/api/groups', { headers: auth(newcomer) }));
  expect(memberships.map((x: any) => x.id)).toContain(g.id);
});
