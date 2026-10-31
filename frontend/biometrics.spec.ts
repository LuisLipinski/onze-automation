import { test } from './support/test';
import { password, register, type Actor } from './support/factory';
import { type Android } from './support/android';
import { enrollFingerprint, clearFingerprint } from './support/biometric-device';

async function enable(ui: Android, actor: Actor) {
  await enrollFingerprint(ui);
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

test('[UI-B01] biometria nativa autentica conta salva e desativação remove o bloqueio', async ({ ui, request }) => {
  test.setTimeout(240_000);
  const actor = await register(request, 'Biometria Android');
  await enable(ui, actor);
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
  await reopen(ui);
  await ui.has(`Olá, ${actor.user.displayName}`);
});

test('[UI-B02] digital desconhecida e cancelamento permitem senha de outra conta sem trocar vínculo', async ({ ui, request }) => {
  test.setTimeout(240_000);
  const first = await register(request, 'Conta biométrica A');
  const second = await register(request, 'Conta com senha B');
  await enable(ui, first);
  await reopen(ui);
  await ui.tap(`Entrar como ${first.user.displayName}`);
  await ui.hasNative('Entrar no Onze');
  await ui.execute('mobile: fingerprint', { fingerprintId: 99 });
  await ui.hasNative('Entrar no Onze');
  await ui.absent('Home');
  await ui.tapNative('Usar senha');
  await ui.has('Biometria não confirmada.', true);
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
});
