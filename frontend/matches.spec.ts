import { test, expect } from './support/test';
import { auth, body, createMatch, getMatch, going, group, profile } from './support/factory';

test('[UI-M01] calendário e relógio são nativos e jogo é criado com convite', async ({ ui, request }) => {
  const g = await group(request, 0);
  await ui.login(g.owner);
  await ui.open('create-match', { groupId: g.id });
  await ui.screen('create-match', 'Data limite de inscrição:', true);
  await ui.tap('Data limite de inscrição:', true);
  await ui.hasId('android:id/datePicker');
  await ui.tapId('android:id/button2');
  await ui.tap('Horário limite de inscrição:', true);
  await ui.hasId('android:id/timePicker');
  await ui.tapId('android:id/button2');
  await ui.tap('Horário do jogo:', true);
  await ui.hasId('android:id/timePicker');
  await ui.tapId('android:id/hours');
  await ui.tap('14');
  await ui.tapId('android:id/minutes');
  await ui.tap('15');
  await ui.tapId('android:id/button1');
  await ui.fill('Ex.: Arena dos Amigos', 'Arena Android');
  await ui.tap('Marcar jogo');
  await ui.has('Compartilhar este jogo?');
  await ui.tap('Agora não');
  await ui.screen('match', 'Arena Android', true);
  await ui.tabs();
  const matches = await body(await request.get(`/api/groups/${g.id}/matches`, { headers: auth(g.owner) }));
  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({ venue: 'Arena Android', requiredGoalkeepers: 2, maxPlayers: 14 });
  expect(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(matches[0].startsAt))).toBe('14:15');
});

test('[UI-M02] formulário valida local e opções de cobrança e tempos', async ({ ui, request }) => {
  const g = await group(request, 0);
  await ui.login(g.owner);
  await ui.open('create-match', { groupId: g.id });
  await ui.tap('Marcar jogo');
  await ui.sees('Informe o local do jogo.');
  await ui.tap('Cobrar pagamento dos jogadores');
  await ui.sees('CHAVE PIX');
  await ui.sees('VALOR POR JOGADOR');
  await ui.tap('Repetir jogo toda semana');
  await ui.sees('Criar jogos semanais');
  expect(await body(await request.get(`/api/groups/${g.id}/matches`, { headers: auth(g.owner) }))).toEqual([]);
});

test('[UI-M03] presença confirma, desabilita repetição e permite liberar vaga', async ({ ui, request, control }) => {
  const g = await group(request, 1);
  await profile(request, g.id, g.members[0]);
  const match = await createMatch(request, control, g.id, g.owner);
  await ui.login(g.members[0]);
  await ui.open('match', { matchId: match.id });
  await ui.tap('✓ Vou jogar');
  await ui.disabled('✓ Vou jogar');
  expect((await getMatch(request, match.id, g.members[0])).myAttendance).toBe('GOING');
  await ui.tap('Não vou');
  await ui.has('Confirmar que não vai?');
  await ui.tap('Liberar minha vaga');
  await ui.disabled('Não vou');
  expect((await getMatch(request, match.id, g.members[0])).myAttendance).toBe('NOT_GOING');
});

test('[UI-M04] próxima ocorrência semanal tem presença fechada e independente', async ({ ui, request, control }) => {
  const g = await group(request, 1);
  await profile(request, g.id, g.members[0]);
  await createMatch(request, control, g.id, g.owner, { recurrence: 'WEEKLY' });
  const matches = await body(await request.get(`/api/groups/${g.id}/matches`, { headers: auth(g.owner) }));
  expect(matches).toHaveLength(4);
  matches.sort((a: any, b: any) => a.startsAt.localeCompare(b.startsAt));
  await going(request, matches[0].id, g.members[0]);
  await ui.login(g.members[0]);
  await ui.open('match', { matchId: matches[1].id });
  await ui.sees('Presença ainda fechada');
  await ui.disabled('✓ Vou jogar');
  await ui.disabled('Não vou');
  expect((await getMatch(request, matches[1].id, g.members[0])).myAttendance).toBeNull();
});

test('[UI-M05] configuração atualiza mínimo e máximo somente neste jogo', async ({ ui, request, control }) => {
  const g = await group(request, 0);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 6 });
  await ui.login(g.owner);
  await ui.open('edit-match-player-config', { matchId: match.id });
  await ui.screen('edit-match-player-config', 'Modalidade e jogadores');
  await ui.fill('2', '3');
  await ui.fill('6', '8');
  await ui.tap('Salvar configuração');
  await expect.poll(async () => (await getMatch(request, match.id, g.owner)).maxPlayers).toBe(8);
  expect((await getMatch(request, match.id, g.owner)).minimumPlayers).toBe(3);
  await ui.has('Home');
});

test('[UI-M06] convidado é criado pela interface e aparece na lista', async ({ ui, request, control }) => {
  const g = await group(request, 0);
  const match = await createMatch(request, control, g.id, g.owner);
  await ui.login(g.owner);
  await ui.open('add-match-guest', { matchId: match.id });
  await ui.screen('add-match-guest', 'Adicionar convidado');
  await ui.fill('Ex.: João', 'Convidado Android');
  await ui.tap('Posição principal do convidado');
  await ui.tap('Goleiro');
  await ui.tap('Adicionar convidado');
  await expect.poll(async () => (await getMatch(request, match.id, g.owner)).guests.length).toBe(1);
  await ui.open('match', { matchId: match.id });
  await ui.sees('Convidado Android — Convidado');
});

test('[UI-M07] cancelar ocorrência semanal preserva as demais', async ({ ui, request, control }) => {
  const g = await group(request, 0);
  const match = await createMatch(request, control, g.id, g.owner, { recurrence: 'WEEKLY' });
  await ui.login(g.owner);
  await ui.open('match', { matchId: match.id });
  await ui.tap('Cancelar somente este jogo');
  await ui.has('Cancelar este jogo?');
  await ui.tap('Cancelar');
  expect((await getMatch(request, match.id, g.owner)).status).toBe('SCHEDULED');
  await ui.tap('Cancelar somente este jogo');
  await ui.tap('Cancelar jogo');
  await expect.poll(async () => (await getMatch(request, match.id, g.owner)).status).toBe('CANCELLED');
  const matches = await body(await request.get(`/api/groups/${g.id}/matches`, { headers: auth(g.owner) }));
  expect(matches.filter((m: any) => m.status === 'SCHEDULED')).toHaveLength(3);
  await ui.sees('Jogo cancelado');
});

test('[UI-M08] falta de mínimo oferece manter jogo e extensão nativa do prazo', async ({ ui, request, control }) => {
  const g = await group(request, 0);
  const match = await createMatch(request, control, g.id, g.owner);
  await control.at(new Date(Date.parse(match.signupDeadline) + 1000).toISOString());
  await control.process();
  await ui.login(g.owner);
  await ui.open('match', { matchId: match.id });
  await ui.sees('Número mínimo não atingido');
  await ui.tap('Estender prazo de inscrição');
  await ui.screen('extend-match-signup', 'Estender prazo');
  await ui.tap('Nova data limite de inscrição:', true);
  await ui.hasId('android:id/datePicker');
  await ui.tapId('android:id/button2');
  await ui.tap('Voltar');
  await ui.tap('Manter mesmo assim');
  await ui.has('Manter abaixo do mínimo?');
  await ui.tap('Manter jogo');
  await expect.poll(async () => (await body(await request.get(`/api/matches/${match.id}/minimum-player-decision`, { headers: auth(g.owner) }))).belowMinimumApproved).toBe(true);
  await ui.absent('Manter mesmo assim');
});

test('[UI-M09] cria série semanal paga pelo Android com PIX e goleiros isentos', async ({ ui, request }) => {
  const g = await group(request, 0);
  await ui.login(g.owner);
  await ui.open('create-match', { groupId: g.id, venue: 'Arena Semanal', paymentAmount: '25', pixKey: 'qa@onze.test' });
  await ui.tap('Cobrar pagamento dos goleiros');
  await ui.tap('Repetir jogo toda semana');
  await ui.tap('Criar jogos semanais');
  await ui.has('Compartilhar este jogo?');
  await ui.tap('Agora não');
  await ui.sees('Arena Semanal', true);
  const matches = await body(await request.get(`/api/groups/${g.id}/matches`, { headers: auth(g.owner) }));
  expect(matches).toHaveLength(4);
  expect(matches.every((match: any) => match.recurrence === 'WEEKLY' && match.paymentRequired && !match.goalkeeperPays && match.paymentAmount === 25)).toBe(true);
});

test('[UI-M10] encerrar série exige confirmação e cancela ocorrências futuras', async ({ ui, request, control }) => {
  const g = await group(request, 0);
  const match = await createMatch(request, control, g.id, g.owner, { recurrence: 'WEEKLY' });
  await ui.login(g.owner);
  await ui.open('match', { matchId: match.id });
  await ui.tap('Encerrar jogos semanais');
  await ui.has('Encerrar todos os jogos semanais?');
  await ui.tap('Encerrar sequência');
  await expect.poll(async () => (await getMatch(request, match.id, g.owner)).seriesActive).toBe(false);
  const matches = await body(await request.get(`/api/groups/${g.id}/matches`, { headers: auth(g.owner) }));
  expect(matches.every((item: any) => item.status === 'CANCELLED')).toBe(true);
  await ui.sees('Jogo cancelado');
});
