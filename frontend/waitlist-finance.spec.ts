import { test, expect } from './support/test';
import { auth, body, createMatch, getMatch, going, group, preparedMatch, profile } from './support/factory';

test('[UI-W01] vagas de goleiro levam jogador de linha para fila e permitem sair', async ({ ui, request, control }) => {
  const g = await group(request, 2);
  for (const actor of g.actors) await profile(request, g.id, actor);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 3 });
  await going(request, match.id, g.owner);
  await ui.login(g.members[0]);
  await ui.open('match', { matchId: match.id });
  await ui.tap('Entrar na lista de espera');
  await ui.sees('Você é o 1º da fila.', true);
  await ui.disabled('Na lista de espera');
  await ui.sees('2 vagas reservadas', true);
  expect((await getMatch(request, match.id, g.members[0])).myAttendance).toBe('WAITLISTED');
  await ui.tap('Sair da fila');
  await ui.tap('Sair da fila');
  await expect.poll(async () => (await getMatch(request, match.id, g.members[0])).myAttendance).toBe('NOT_GOING');
  await ui.disabled('Não vou');
});

test('[UI-W02] administrador aprova primeiro reserva no gol após o prazo', async ({ ui, request, control }) => {
  const g = await group(request, 2);
  for (const actor of g.actors) await profile(request, g.id, actor);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 3 });
  for (const actor of g.actors) await going(request, match.id, actor);
  await control.at(new Date(Date.parse(match.signupDeadline) + 1000).toISOString());
  await control.process();
  await ui.login(g.owner);
  await ui.open('match', { matchId: match.id });
  await ui.tap('Usar primeiro reserva no gol');
  await ui.has('Usar reserva como goleiro?');
  await ui.tap('Confirmar');
  await expect.poll(async () => (await getMatch(request, match.id, g.members[0])).myAttendance).toBe('GOING');
  const player = (await getMatch(request, match.id, g.owner)).attendances.find((a: any) => a.userId === g.members[0].user.id);
  expect(player.isGoalkeeper).toBe(true);
  await ui.sees('1 vaga reservada', true);
});

test('[UI-W03] preferência pelo membro da fila remove convidado após confirmação', async ({ ui, request, control }) => {
  const g = await group(request, 1);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 4 });
  for (const displayName of ['Aluguel A', 'Aluguel B']) await body(await request.post(`/api/matches/${match.id}/rental-goalkeepers`, { headers: auth(g.owner), data: { displayName } }));
  await going(request, match.id, g.owner);
  await body(await request.post(`/api/matches/${match.id}/guests`, { headers: auth(g.owner), data: { displayName: 'Convidado', primaryPosition: 'MIDFIELDER' } }));
  await going(request, match.id, g.members[0]);
  await ui.login(g.owner);
  await ui.open('match', { matchId: match.id });
  await ui.sees('Convidado ou membro da fila?');
  await ui.tap(`Substituir Convidado por ${g.members[0].user.displayName}`);
  await ui.has('Dar preferência ao membro?');
  await ui.tap('Confirmar');
  await expect.poll(async () => (await getMatch(request, match.id, g.members[0])).myAttendance).toBe('GOING');
  expect((await getMatch(request, match.id, g.owner)).guests).toHaveLength(0);
  await ui.absent('Convidado ou membro da fila?');
});

test('[UI-W04] goleiro de aluguel ocupa vaga reservada e pode ser removido', async ({ ui, request, control }) => {
  const g = await group(request, 0);
  const match = await createMatch(request, control, g.id, g.owner);
  await ui.login(g.owner);
  await ui.open('match', { matchId: match.id });
  await ui.tap('+ Adicionar goleiro de aluguel');
  await ui.fill('Ex.: Carlos', 'Aluguel Android');
  await ui.tap('Adicionar');
  await ui.sees('Aluguel Android — Goleiro de aluguel');
  expect((await getMatch(request, match.id, g.owner)).currentGoalkeepers).toBe(1);
  await ui.tap('Remover', true);
  await ui.has('Remover goleiro de aluguel?');
  await ui.tap('Remover goleiro');
  await expect.poll(async () => (await getMatch(request, match.id, g.owner)).currentGoalkeepers).toBe(0);
  await ui.absent('Aluguel Android — Goleiro de aluguel');
});

test('[UI-F01] jogador informa pagamento e administrador rejeita e depois confirma', async ({ ui, request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const player = g.members[1];
  await ui.login(player);
  await ui.open('match', { matchId: g.match.id });
  await ui.tap('Já paguei');
  await ui.sees('Pagamento informado.', true);
  expect((await getMatch(request, g.match.id, player)).myPaymentStatus).toBe('REPORTED');
  await ui.reset();
  await ui.login(g.owner);
  await ui.open('match', { matchId: g.match.id });
  await ui.tap('Não foi pago');
  await ui.has('Pagamento não recebido?');
  await ui.tap('Marcar como pendente');
  await expect.poll(async () => (await getMatch(request, g.match.id, player)).myPaymentStatus).toBe('PENDING');
  await ui.sees('Cobrar jogador');
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(player) }));
  await ui.open('home');
  await ui.open('match', { matchId: g.match.id });
  await ui.tap('Confirmar recebimento');
  await expect.poll(async () => (await getMatch(request, g.match.id, player)).myPaymentStatus).toBe('PAID');
  await ui.sees('PAGO');
});

test('[UI-F02] cobrar jogador gera notificação sem confirmar recebimento', async ({ ui, request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  await ui.login(g.owner);
  await ui.open('match', { matchId: g.match.id });
  await ui.tap('Cobrar jogador');
  await ui.sees('Cobrança solicitada.', true);
  const rows = await control.call('/outbox');
  expect(rows.some((row: any) => row.notification_type === 'PAYMENT_REMINDER')).toBe(true);
  expect((await getMatch(request, g.match.id, g.owner)).myPaymentStatus).toBe('PENDING');
  await ui.absent('Confirmar recebimento');
});

test('[UI-F03] crédito do jogador e lista financeira do admin respeitam privacidade', async ({ ui, request }) => {
  const g = await group(request, 1);
  await ui.login(g.members[0]);
  await ui.open('group-credits', { groupId: g.id, canManage: 'false' });
  await ui.screen('group-credits', 'Meu crédito');
  await ui.sees('Nenhum crédito ativo');
  await ui.tabs();
  await ui.reset();
  await ui.login(g.owner);
  await ui.open('group-credits', { groupId: g.id, canManage: 'true' });
  await ui.has('Créditos dos jogadores');
  await ui.sees('Nenhum crédito ativo');
});

test('[UI-F04] qualquer membro abre compartilhamento do jogo sem controles de admin', async ({ ui, request, control }) => {
  const g = await group(request, 1);
  const match = await createMatch(request, control, g.id, g.owner);
  await ui.login(g.members[0]);
  await ui.open('match', { matchId: match.id });
  await ui.tap('Compartilhar jogo');
  await ui.shareSheet();
  await ui.back();
  await ui.sees('Arena QA', true);
  await ui.absent('Gerenciar jogo');
});

test('[UI-F05] cancelamento pago permite crédito em lote com confirmação', async ({ ui, request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const player = g.members[1];
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(player) }));
  await body(await request.put(`/api/matches/${g.match.id}/payments/${player.user.id}/confirm`, { headers: auth(g.owner) }));
  await body(await request.delete(`/api/matches/${g.match.id}`, { headers: auth(g.owner) }), 204);
  await ui.login(g.owner);
  await ui.open('match', { matchId: g.match.id });
  await ui.tap('Selecionar todos', true);
  await ui.tap('Manter como crédito');
  await ui.has('Manter valores como crédito?');
  await ui.tap('Manter como crédito');
  await expect.poll(async () => (await body(await request.get(`/api/groups/${g.id}/credits`, { headers: auth(player) })))[0]?.availableAmount).toBe(25);
  await ui.open('group-credits', { groupId: g.id, canManage: 'true' });
  await ui.sees(player.user.displayName);
  await ui.sees('25,00', true);
});
