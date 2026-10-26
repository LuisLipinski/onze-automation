import { test, expect } from './support/test';
import { auth, body, group, promote, readGroup, register } from './support/factory';

test('[UI-G01] cria grupo nas três etapas com dados opcionais', async ({ ui, request }) => {
  const actor = await register(request);
  await ui.login(actor);
  await ui.open('create-group');
  await ui.screen('create-group', 'Ex.: Pelada de Quinta');
  await ui.tap('Continuar');
  await ui.sees('Digite o nome do grupo/time.');
  await ui.fill('Ex.: Pelada de Quinta', 'Pelada Android');
  await ui.fill('Conte um pouco sobre o grupo...', 'Criado pelo teste nativo');
  await ui.tap('Continuar');
  await ui.screen('create-group-details', 'Complete o grupo');
  await ui.fill('Ex.: Curitiba', 'Curitiba');
  await ui.fill('Ex.: Arena dos Amigos', 'Arena Android');
  await ui.tap('Salvar e continuar');
  await ui.screen('create-group-invite', 'Grupo criado! 🎉');
  await ui.tap('Pular');
  await ui.has('Você pode convidar depois');
  await ui.tap('Ir para meus grupos');
  await ui.has('Pelada Android');
  const groups = await body(await request.get('/api/groups', { headers: auth(actor) }));
  expect(groups[0]).toMatchObject({ name: 'Pelada Android', city: 'Curitiba', venue: 'Arena Android', role: 'PRIMARY_ADMIN' });
});

test('[UI-G02] aceita convite digitado e exige perfil esportivo', async ({ ui, request }) => {
  const g = await group(request, 0);
  const actor = await register(request);
  await ui.login(actor);
  await ui.open('join-group');
  await ui.screen('join-group', 'Entrar em um grupo');
  await ui.fill('Ex.: A7K9M2Q4', g.invitation.code);
  await ui.tap('Entrar no grupo');
  await ui.has('Preencher perfil esportivo');
  await ui.tap('Preencher perfil esportivo');
  await ui.has('MEU PERFIL ESPORTIVO');
  expect((await body(await request.get('/api/groups', { headers: auth(actor) }))).map((x: any) => x.id)).toContain(g.id);
});

test('[UI-G03] renova convite somente após confirmação e abre compartilhamento Android', async ({ ui, request }) => {
  const g = await group(request, 0);
  await ui.login(g.owner);
  await ui.open('group-invite', { groupId: g.id });
  await ui.screen('group-invite', 'Compartilhe o convite');
  await ui.sees(g.invitation.code);
  await ui.tap('Gerar novo convite');
  await ui.tap('Cancelar');
  await ui.sees(g.invitation.code);
  await ui.tap('Gerar novo convite');
  await ui.has('Gerar novo convite?');
  await ui.tap('Gerar novo convite');
  await expect.poll(async () => (await body(await request.post(`/api/groups/${g.id}/invite`, { headers: auth(g.owner) }))).code).not.toBe(g.invitation.code);
  const invitation = await body(await request.post(`/api/groups/${g.id}/invite`, { headers: auth(g.owner) }));
  expect(invitation.code).not.toBe(g.invitation.code);
  await ui.sees(invitation.code);
  await ui.tap('Compartilhar convite');
  await ui.shareSheet();
  await ui.back();
});

test('[UI-G04] membro vê seu menu e não vê comandos administrativos', async ({ ui, request }) => {
  const g = await group(request, 1);
  await ui.login(g.members[0]);
  await ui.open('group', { groupId: g.id });
  await ui.tap('☰');
  await ui.has('Meu perfil esportivo');
  await ui.has('Estatísticas');
  await ui.has('Meu crédito');
  for (const label of ['Ver membros', 'Convidar novos membros', 'Marcar jogo', 'Configurações do grupo']) await ui.absent(label);
});

test('[UI-G05] promoção começa sem funções e permissões são salvas individualmente', async ({ ui, request }) => {
  const g = await group(request, 1);
  await ui.login(g.owner);
  await ui.open('group-admins', { groupId: g.id });
  await ui.screen('group-admins', 'MEMBROS');
  await ui.tap('Promover');
  await ui.has('Promover para administrador?');
  await ui.tap('Promover');
  await expect.poll(async () => (await body(await request.get(`/api/groups/${g.id}/members`, { headers: auth(g.owner) }))).find((m: any) => m.userId === g.members[0].user.id).role).toBe('ADMIN');
  let members = await body(await request.get(`/api/groups/${g.id}/members`, { headers: auth(g.owner) }));
  expect(members.find((m: any) => m.userId === g.members[0].user.id)).toMatchObject({ role: 'ADMIN', permissions: [] });
  await ui.tap('Editar permissões');
  await ui.screen('group-admin-permissions', 'EDITAR ADMINISTRADOR');
  const labels = ['Adicionar membros', 'Remover membros', 'Promover membros', 'Editar grupo', 'Marcar e configurar jogos', 'Cancelar jogos', 'Gerenciar lista de jogadores', 'Gerenciar finanças', 'Gerenciar escalações', 'Controlar jogo ao vivo', 'Editar perfis e avaliações'];
  for (const label of labels) await ui.tap(label);
  await ui.tap('Salvar permissões');
  await ui.sees('Permissões atualizadas.', true);
  const all = await body(await request.get(`/api/groups/${g.id}/members`, { headers: auth(g.owner) }));
  expect(all.find((m: any) => m.userId === g.members[0].user.id).permissions).toHaveLength(labels.length);
  for (const label of labels.slice(1)) await ui.tap(label);
  await ui.tap('Salvar permissões');
  await expect.poll(async () => (await body(await request.get(`/api/groups/${g.id}/members`, { headers: auth(g.owner) }))).find((m: any) => m.userId === g.members[0].user.id).permissions).toEqual(['ADD_MEMBERS']);
  members = await body(await request.get(`/api/groups/${g.id}/members`, { headers: auth(g.owner) }));
  expect(members.find((m: any) => m.userId === g.members[0].user.id).permissions).toEqual(['ADD_MEMBERS']);
});

test('[UI-G06] administrador delegado vê somente as funções autorizadas', async ({ ui, request }) => {
  const g = await group(request, 1);
  await promote(request, g.id, g.owner, g.members[0], ['ADD_MEMBERS']);
  await ui.login(g.members[0]);
  await ui.open('group', { groupId: g.id });
  await ui.tap('☰');
  await ui.has('Convidar novos membros');
  await ui.absent('Marcar jogo');
  await ui.absent('Configurações do grupo');
  await ui.absent('Créditos dos jogadores');
});

test('[UI-G07] principal transfere cargo com confirmação', async ({ ui, request }) => {
  const g = await group(request, 1);
  await promote(request, g.id, g.owner, g.members[0]);
  await ui.login(g.owner);
  await ui.open('group-admins', { groupId: g.id });
  await ui.tap('Tornar principal');
  await ui.has('Tornar Administrador Principal?');
  await ui.tap('Cancelar');
  await ui.tap('Tornar principal');
  await ui.tap('Transferir cargo');
  await expect.poll(async () => (await readGroup(request, g.id, g.members[0]))?.role).toBe('PRIMARY_ADMIN');
  await ui.sees('Administrador principal');
});

test('[UI-G08] rebaixa administrador e remove membro com confirmação', async ({ ui, request }) => {
  const g = await group(request, 1);
  await promote(request, g.id, g.owner, g.members[0]);
  await ui.login(g.owner);
  await ui.open('group-admins', { groupId: g.id });
  await ui.tap('Rebaixar');
  await ui.has('Rebaixar para membro?');
  await ui.tap('Rebaixar');
  await ui.tap('Remover');
  await ui.has('Remover membro do grupo?');
  await ui.tap('Remover');
  await expect.poll(async () => (await body(await request.get(`/api/groups/${g.id}/members`, { headers: auth(g.owner) }))).length).toBe(1);
  await ui.absent(g.members[0].user.displayName);
});

test('[UI-G09] configura grupo e confirmação de exclusão permite cancelar', async ({ ui, request }) => {
  const g = await group(request, 1);
  await ui.login(g.owner);
  await ui.open('group-settings', { groupId: g.id });
  await ui.screen('group-settings', 'Complete seu grupo');
  await ui.fill('Ex.: Curitiba', 'Londrina');
  await ui.tap('Salvar configurações');
  await ui.has('Configurações salvas');
  expect((await readGroup(request, g.id, g.owner)).city).toBe('Londrina');
  await ui.tap('Voltar');
  await ui.open('group-settings', { groupId: g.id });
  await ui.tap('Excluir grupo');
  await ui.has('Excluir este grupo?');
  await ui.tap('Manter grupo');
  expect(await readGroup(request, g.id, g.owner)).toBeTruthy();
  await ui.tap('Excluir grupo');
  await ui.tap('Excluir grupo');
  await expect.poll(async () => readGroup(request, g.id, g.owner)).toBeUndefined();
  await ui.reset();
  await ui.signIn(g.members[0]);
  await ui.sees('Grupo excluído', true);
  await ui.tap('Ver meus grupos');
  await ui.has('Você ainda não participa de um grupo');
  expect(await body(await request.get('/api/groups/deletion-notices', { headers: auth(g.members[0]) }))).toEqual([]);
});

test('[UI-G10] membro sai após confirmação e grupo desaparece', async ({ ui, request }) => {
  const g = await group(request, 1);
  await ui.login(g.members[0]);
  await ui.open('group', { groupId: g.id });
  await ui.tap('☰');
  await ui.tap('Sair do grupo');
  await ui.has('Sair deste grupo?');
  await ui.tap('Sair do grupo');
  await ui.has('Você ainda não participa de um grupo');
  expect(await body(await request.get('/api/groups', { headers: auth(g.members[0]) }))).toEqual([]);
});
