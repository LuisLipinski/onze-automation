import { test, expect } from './support/test';
import { type TestInfo } from '@playwright/test';
import { auth, group, password, register, type Actor } from './support/factory';
import { type Android } from './support/android';
import { enrollFingerprint, clearFingerprint } from './support/biometric-device';

async function enable(ui: Android, actor: Actor, info: TestInfo) {
  await enrollFingerprint(ui, info);
  await ui.login(actor);
  await ui.tap('Configurações');
  await ui.tap('Login com biometria');
  await ui.has('Login com biometria ativado para', true);
}
async function reopen(ui: Android) {
  await ui.execute('mobile: terminateApp', { appId: 'com.onze.organizadordepelada' });
  await ui.execute('mobile: activateApp', { appId: 'com.onze.organizadordepelada' });
}
test.afterEach(async ({ ui }) => { await clearFingerprint(ui); });

test('[UI-B01] biometria nativa autentica conta salva e desativação remove o bloqueio', async ({ ui, request, control }, info) => {
  test.setTimeout(240_000);
  const actor = await register(request, 'Biometria Android');
  await enable(ui, actor, info);
  await reopen(ui);
  await ui.has(`Entrar como ${actor.user.displayName}`);
  await ui.absent('Home');
  await ui.tap(`Entrar como ${actor.user.displayName}`);
  await ui.hasNative('Entrar no Onze');
  await ui.execute('mobile: fingerprint', { fingerprintId: 1 });
  await ui.has(`Olá, ${actor.user.displayName}`);
  await ui.tap('Configurações');
  await ui.tap('Login com biometria');
  await ui.has('Login com biometria desativado neste aparelho.');
  expect((await control.call('/session-stats')).revoked).toBe(2);
  await reopen(ui);
  await ui.has(`Olá, ${actor.user.displayName}`);
});

test('[UI-B02] digital desconhecida e cancelamento permitem senha de outra conta sem trocar vínculo', async ({ ui, request, control }, info) => {
  test.setTimeout(240_000);
  const first = await register(request, 'Conta biométrica A');
  const second = await register(request, 'Conta com senha B');
  await enable(ui, first, info);
  await reopen(ui);
  await ui.tap(`Entrar como ${first.user.displayName}`);
  await ui.hasNative('Entrar no Onze');
  await ui.execute('mobile: fingerprint', { fingerprintId: 99 });
  await ui.hasNative('Entrar no Onze');
  await ui.absent('Home');
  await ui.tapNative('Usar senha');
  await ui.has('Biometria não confirmada.', true);
  expect((await control.call('/session-stats')).consumed).toBe(0);
  await ui.fill(first.user.email, second.user.email);
  await ui.fill('Senha', password);
  await ui.tap('Entrar');
  await ui.has(`Olá, ${second.user.displayName}`);
  await reopen(ui);
  await ui.has(`Olá, ${second.user.displayName}`);
  await ui.tap('Configurações');
  await ui.tap('Sair da conta');
  await ui.tap(`Voltar para ${first.user.displayName}`);
  await ui.tap(`Entrar como ${first.user.displayName}`);
  await ui.hasNative('Entrar no Onze');
  await ui.execute('mobile: fingerprint', { fingerprintId: 1 });
  await ui.has(`Olá, ${first.user.displayName}`);
  expect((await control.call('/session-stats')).consumed).toBe(1);
});

test('[UI-B03] digital renova acesso vencido em dois reinícios sem solicitar senha', async ({ ui, request, control }, info) => {
  test.setTimeout(300_000);
  const g = await group(request, 0);
  await enable(ui, g.owner, info);
  for (let cycle = 1; cycle <= 2; cycle++) {
    await control.advanceAuth(3 * 3600_000);
    expect((await request.get('/api/auth/me', { headers: auth(g.owner) })).status()).toBe(401);
    await reopen(ui);
    await ui.screen('index', `Entrar como ${g.owner.user.displayName}`);
    await ui.absent('Senha');
    await ui.tap(`Entrar como ${g.owner.user.displayName}`);
    await ui.hasNative('Entrar no Onze');
    await ui.execute('mobile: fingerprint', { fingerprintId: 1 });
    await ui.screen('home', `Olá, ${g.owner.user.displayName}`);
    await ui.tap('Grupos');
    await ui.screen('groups', 'Grupo automação');
    expect((await control.call('/session-stats')).consumed).toBe(cycle);
  }
});

test('[UI-B04] falha temporária de renovação preserva digital e nova tentativa entra sem senha', async ({ ui, request, control }, info) => {
  test.setTimeout(240_000);
  const actor = await register(request, 'Biometria sem senha');
  await enable(ui, actor, info);
  await reopen(ui);
  await control.call('/boundaries', { failRefresh: true });
  await ui.tap(`Entrar como ${actor.user.displayName}`);
  await ui.hasNative('Entrar no Onze');
  await ui.execute('mobile: fingerprint', { fingerprintId: 1 });
  await ui.has('Não foi possível renovar seu acesso agora. Tente novamente.');
  await ui.has(`Entrar como ${actor.user.displayName}`);
  await ui.absent('Senha');
  expect((await control.call('/session-stats')).consumed).toBe(0);
  await control.call('/boundaries', { failRefresh: false });
  await ui.tap(`Entrar como ${actor.user.displayName}`);
  await ui.hasNative('Entrar no Onze');
  await ui.execute('mobile: fingerprint', { fingerprintId: 1 });
  await ui.has(`Olá, ${actor.user.displayName}`);
  expect((await control.call('/session-stats')).consumed).toBe(1);
});
