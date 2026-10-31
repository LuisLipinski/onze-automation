import { test, expect } from './support/test';
import { createMatch, getMatch, group } from './support/factory';

test.describe('primeira solicitação de notificações', () => {
  test.use({ notificationPermission: 'prompt' });

  test('[UI-N01] recusa nativa mantém navegação e presença sem repetir solicitação', async ({ ui, request, control }) => {
    const g = await group(request, 0);
    const match = await createMatch(request, control, g.id, g.owner);
    ui.observePermissionRequests();
    await ui.signIn(g.owner);
    await ui.hasId('com.android.permissioncontroller:id/permission_deny_button');
    await ui.tapId('com.android.permissioncontroller:id/permission_deny_button');
    await ui.has(`Olá, ${g.owner.user.displayName}`);
    ui.notificationPermission(false);
    await ui.open('match', { matchId: match.id });
    await ui.tap('✓ Vou jogar');
    await expect.poll(async () => (await getMatch(request, match.id, g.owner)).myAttendance).toBe('GOING');
    for (let resume = 0; resume < 2; resume++) {
      await ui.execute('mobile: backgroundApp', { seconds: 1 });
      await ui.has('Home');
      await ui.tap('Home');
      await ui.has(`Olá, ${g.owner.user.displayName}`);
      await ui.open('match', { matchId: match.id });
      await ui.sees('Lista de presença');
      expect(ui.permissionRequests()).toBe(1);
    }
    ui.notificationPermission(false);
  });
});

test.describe('notificações já bloqueadas no Android', () => {
  test.use({ notificationPermission: 'prompt' });

  test('[UI-N02] permissão bloqueada não abre atividades durante refresh e retorno ao app', async ({ ui, request, control }) => {
    const g = await group(request, 0);
    const match = await createMatch(request, control, g.id, g.owner);
    await ui.signIn(g.owner);
    await ui.hasId('com.android.permissioncontroller:id/permission_deny_button');
    await ui.tapId('com.android.permissioncontroller:id/permission_deny_button');
    await ui.has(`Olá, ${g.owner.user.displayName}`);
    ui.blockNotificationPermission();
    ui.observePermissionRequests();
    await ui.execute('mobile: terminateApp', { appId: 'com.onze.organizadordepelada' });
    await ui.execute('mobile: activateApp', { appId: 'com.onze.organizadordepelada' });
    await ui.has(`Olá, ${g.owner.user.displayName}`);
    for (let resume = 0; resume < 2; resume++) {
      await ui.open('match', { matchId: match.id });
      await ui.sees('Lista de presença');
      await ui.execute('mobile: backgroundApp', { seconds: 1 });
      await ui.has('Home');
      await ui.tap('Home');
      await ui.has(`Olá, ${g.owner.user.displayName}`);
      expect(ui.permissionRequests()).toBe(0);
    }
    await ui.tap('Configurações');
    await ui.sees('Sua conta');
    ui.notificationPermission(false);
  });
});
