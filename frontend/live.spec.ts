import { test, expect } from './support/test';
import { auth, body, generatedMatch, getMatch, live, liveMatch, preparedMatch } from '../tests/support/factory';

test('[UI-T01] forma times, regenera e abre compartilhamento da escalação', async ({ ui, request, control }) => {
  const g = await preparedMatch(request, control);
  await ui.login(g.owner);
  await ui.open('match-teams', { matchId: g.match.id });
  await ui.screen('match-teams', 'Formar times automaticamente');
  await ui.tap('Formar times automaticamente');
  await ui.sees('Gerar novamente');
  const teams = await body(await request.get(`/api/matches/${g.match.id}/teams`, { headers: auth(g.owner) }));
  expect(teams.teams).toHaveLength(2);
  expect(teams.teams.flatMap((team: any) => team.assignments)).toHaveLength(4);
  await ui.tap('Gerar novamente');
  await ui.sees('Compartilhar escalação');
  await ui.tap('Compartilhar escalação');
  await ui.shareSheet();
  await ui.back();
});

test('[UI-T02] escalação do membro é somente leitura e ferramenta desligada fica oculta', async ({ ui, request, control }) => {
  const g = await generatedMatch(request, control);
  await ui.login(g.members[0]);
  await ui.open('match-teams', { matchId: g.match.id });
  await ui.sees('Compartilhar escalação');
  await ui.absent('Gerar novamente');
  await ui.absent('Editar');
  await ui.absent('🧪 Ferramentas de teste');
  await ui.open('dev-test-data', { matchId: g.match.id });
  await ui.screen('dev-test-data', 'Arena QA', true);
  await ui.absent('Somente development');
});

test('[UI-T03] edição manual muda posição, time e reserva sem duplicar jogador', async ({ ui, request, control }) => {
  const g = await generatedMatch(request, control);
  const field = g.assignments.find(a => a.assignedRole !== 'GOALKEEPER');
  await ui.login(g.owner);
  await ui.open('match-teams', { matchId: g.match.id });
  await ui.tapWithin(field.displayName, 'Editar');
  await ui.tap('Pivô');
  const teams = async () => body(await request.get(`/api/matches/${g.match.id}/teams`, { headers: auth(g.owner) }));
  await expect.poll(async () => (await teams()).teams.flatMap((team: any) => team.assignments).find((a: any) => a.id === field.id).assignedRole).toBe('PIVOT');
  await ui.tap('Próximo time');
  await expect.poll(async () => (await teams()).teams.find((team: any) => team.assignments.some((a: any) => a.id === field.id)).teamNumber).toBe(field.teamNumber === 1 ? 2 : 1);
  await ui.tap('Mandar para reserva');
  await ui.sees('RESERVA');
  const reserves = await body(await request.get(`/api/matches/${g.match.id}/teams/reserves`, { headers: auth(g.owner) }));
  expect(reserves.reserveAssignmentIds).toContain(field.id);
  expect((await teams()).teams.flatMap((team: any) => team.assignments).filter((a: any) => a.id === field.id)).toHaveLength(1);
});

test('[UI-L01] inicia jogo pelo Android com nomes dos dois times', async ({ ui, request, control }) => {
  const g = await generatedMatch(request, control);
  await ui.login(g.owner);
  await ui.open('match', { matchId: g.match.id });
  await ui.tap('Iniciar jogo');
  await ui.fillByLabel('Nome do time 1', 'Preto');
  await ui.fillByLabel('Nome do time 2', 'Branco');
  await ui.tap('Iniciar jogo');
  await ui.screen('live-match', 'Jogo ao vivo');
  await ui.sees('Preto');
  expect((await live(request, g.match.id, g.owner)).status).toBe('IN_PROGRESS');
});

test('[UI-L02] gol com assistência atualiza placar e eventos', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  const [scorer, assist] = g.assignments.filter(a => a.teamNumber === 1);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Aumentar placar de Preto');
  await ui.has('Registrar gol');
  await ui.tap(scorer.displayName);
  await ui.tap(assist.displayName);
  await ui.tap('Salvar gol');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).goalEvents.length).toBe(1);
  const state = await live(request, g.match.id, g.owner);
  expect(state.goalEvents[0]).toMatchObject({ scorerAssignmentId: scorer.id, assistAssignmentId: assist.id });
  expect(state.scores[0].score).toBe(1);
  await ui.sees('Linha do tempo');
});

test('[UI-L03] gol contra é atribuído ao adversário sem chute automático', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  const opponent = g.assignments.find(a => a.teamNumber === 2);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Aumentar placar de Preto');
  await ui.tap('Gol contra');
  await ui.tap(opponent.displayName);
  await ui.tap('Salvar gol');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).goalEvents.length).toBe(1);
  const state = await live(request, g.match.id, g.owner);
  expect(state.goalEvents[0]).toMatchObject({ scorerAssignmentId: opponent.id, ownGoal: true, sideNumber: 1, shotRecorded: false });
  await ui.sees('contra', true);
});

test('[UI-L04] exclusão confirmada do gol corrige placar e estatísticas', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  await body(await request.post(`/api/matches/${g.match.id}/live/goals`, { headers: auth(g.owner), data: { scorerAssignmentId: g.assignments[0].id, penalty: false } }), 201);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Remover evento da linha do tempo');
  await ui.has('Remover gol?');
  await ui.tap('Remover');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).goalEvents.length).toBe(0);
  expect((await live(request, g.match.id, g.owner)).scores.every((s: any) => s.score === 0)).toBe(true);
  await ui.absent('Remover evento da linha do tempo');
});

test('[UI-L05] chute e escanteio entram nos detalhes e correção remove escanteio', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  const player = g.assignments.find(a => a.teamNumber === 1);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Registrar chute no gol para Preto');
  await ui.has('Chute no gol');
  await ui.tap(player.displayName);
  await ui.tap('Salvar chute');
  await ui.tap('Registrar escanteio para Preto');
  await ui.tap('Detalhes do jogo');
  await ui.sees('Escanteios');
  let state = await live(request, g.match.id, g.owner);
  expect(state.teamStatistics[0]).toMatchObject({ shots: 1, shotsOnTarget: 1, corners: 1 });
  await ui.tap('Remover um registro de escanteios do time 1');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).teamStatistics[0].corners).toBe(0);
  await ui.tabs();
});

test('[UI-L06] falta seleciona vítima do lado clicado e autor adversário', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  const victim = g.assignments.find(a => a.teamNumber === 1);
  const offender = g.assignments.find(a => a.teamNumber === 2);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Registrar falta sofrida por Preto');
  await ui.has('Quem sofreu a falta?');
  await ui.tap(victim.displayName);
  await ui.tap(offender.displayName);
  await ui.tap('Registrar');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).foulEvents.length).toBe(1);
  expect((await live(request, g.match.id, g.owner)).foulEvents[0]).toMatchObject({ victimAssignmentId: victim.id, offenderAssignmentId: offender.id, penalty: false });
  await ui.absent('fez falta', true);
});

test('[UI-L07] pênalti registra infração e cobrança convertida separadamente', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  const victim = g.assignments.find(a => a.teamNumber === 1);
  const offender = g.assignments.find(a => a.teamNumber === 2);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Registrar pênalti sofrido por Preto');
  await ui.tap(victim.displayName);
  await ui.tap(offender.displayName);
  await ui.tap('Registrar');
  await ui.has('Quem vai cobrar?');
  await ui.tap(victim.displayName);
  await ui.tap('Continuar');
  await ui.tap('Sim, gol');
  await ui.tap('Salvar resultado');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).goalEvents.length).toBe(1);
  const state = await live(request, g.match.id, g.owner);
  expect(state.foulEvents[0]).toMatchObject({ penalty: true, victimAssignmentId: victim.id, offenderAssignmentId: offender.id });
  expect(state.goalEvents[0].penalty).toBe(true);
  await ui.sees('fez pênalti', true);
});

test('[UI-L08] pênalti perdido não soma gol e exclusão desfaz a cobrança vinculada', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  const victim = g.assignments.find(a => a.teamNumber === 1);
  const offender = g.assignments.find(a => a.teamNumber === 2);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Registrar pênalti sofrido por Preto');
  await ui.tap(victim.displayName);
  await ui.tap(offender.displayName);
  await ui.tap('Registrar');
  await ui.tap(victim.displayName);
  await ui.tap('Continuar');
  await ui.tap('Não, perdeu');
  await ui.tap('Salvar resultado');
  await ui.sees('Pênalti perdido', true);
  const before = await live(request, g.match.id, g.owner);
  expect(before.goalEvents).toHaveLength(0);
  await ui.tap('Remover evento da linha do tempo');
  await ui.tap('Remover');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).foulEvents.length).toBe(0);
  await ui.absent('Pênalti perdido', true);
});

test('[UI-L09] segundo amarelo expulsa e impede selecionar jogador para gol', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  const player = g.assignments.find(a => a.teamNumber === 1);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  for (let i = 1; i <= 2; i++) {
    await ui.tap('Registrar cartão amarelo para Preto');
    await ui.tap(player.displayName);
    await ui.tap('Salvar cartão');
    await expect.poll(async () => (await live(request, g.match.id, g.owner)).cardEvents.length).toBe(i);
  }
  await ui.tap('Aumentar placar de Preto');
  await ui.has('Registrar gol');
  await ui.disabled(player.displayName);
});

test('[UI-L10] tempos respeitam relógio e administrador inicia segundo tempo', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control, { periodsEnabled: true, periodCount: 2, periodDurationMinutes: 1 });
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.sees('Controle dos tempos');
  await ui.absent('Encerrar 1º tempo');
  await ui.tap('Adicionar acréscimos');
  await ui.fillByLabel('Minutos de acréscimos', '0');
  await ui.tap('Salvar');
  await control.advance(60_000);
  await ui.open('home');
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Encerrar 1º tempo');
  await ui.sees('Iniciar 2º tempo');
  await ui.tap('Iniciar 2º tempo');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).periods.length).toBe(2);
  await ui.sees('2º tempo em andamento.');
});

test('[UI-L11] finaliza jogo com confirmação e libera estatísticas', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Finalizar jogo');
  await ui.has('Finalizar este jogo?');
  await ui.tap('Finalizar jogo');
  await expect.poll(async () => (await getMatch(request, g.match.id, g.owner)).status).toBe('FINISHED');
  await ui.sees('FINALIZADA');
  expect((await body(await request.get(`/api/groups/${g.id}/statistics`, { headers: auth(g.owner) }))).finishedMatches).toBe(1);
});

test('[UI-L12] reset confirmado devolve jogo ao estado agendado', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Resetar jogo');
  await ui.has('Resetar este jogo?');
  await ui.tap('Resetar jogo');
  await expect.poll(async () => (await getMatch(request, g.match.id, g.owner)).status).toBe('SCHEDULED');
  await ui.sees('Arena QA', true);
});

test('[UI-L13] espectador recebe evento ao vivo e não tem botões administrativos', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  await ui.login(g.members[0]);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.sees('Você está acompanhando ao vivo');
  await ui.absent('Aumentar placar de Preto');
  await ui.absent('Finalizar jogo');
  await body(await request.post(`/api/matches/${g.match.id}/live/goals`, { headers: auth(g.owner), data: { scorerAssignmentId: g.assignments[0].id, penalty: false } }), 201);
  await ui.sees('Linha do tempo');
  await ui.sees(g.assignments[0].displayName, true);
});

test('[UI-L14] cobranças alternadas definem vencedor e confirmação encerra disputa', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control, { periodsEnabled: true, periodCount: 1, periodDurationMinutes: 1, penaltyShootoutEnabled: true });
  const path = `/api/matches/${g.match.id}/live`;
  await control.advance(60_000);
  await body(await request.put(path + '/period/finish', { headers: auth(g.owner) }));
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  for (const [teamNumber, teamName] of [[1, 'Preto'], [2, 'Branco']] as const) {
    const player = g.assignments.find(a => a.teamNumber === teamNumber);
    for (let kick = 1; kick <= 5; kick++) {
      await ui.tapWithin(`${teamName} — primeiros 5 batedores`, `${kick}º — Selecionar jogador`);
      await ui.tap(player.displayName);
    }
  }
  await ui.tap('Iniciar disputa por pênaltis');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).penaltyShootout.status).toBe('IN_PROGRESS');
  for (let i = 0; i < 6; i++) {
    await ui.tap(i % 2 === 0 ? 'Gol' : 'Perdeu');
    await expect.poll(async () => (await live(request, g.match.id, g.owner)).penaltyShootout.attempts.length).toBe(i + 1);
  }
  await ui.has('Preto venceu nos pênaltis!');
  await ui.tap('OK e encerrar jogo');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).status).toBe('FINISHED');
  await ui.sees('venceu nos pênaltis por', true);
});

test('[UI-L15] vermelho direto e remoção restauram elegibilidade do jogador', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  const player = g.assignments.find(a => a.teamNumber === 2);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Registrar cartão vermelho para Branco');
  await ui.tap(player.displayName);
  await ui.tap('Salvar cartão');
  await ui.sees('CARTÃO VERMELHO • EXPULSO');
  await ui.tap('Remover evento da linha do tempo');
  await ui.tap('Remover');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).cardEvents.length).toBe(0);
  await ui.absent('CARTÃO VERMELHO • EXPULSO');
});

test('[UI-L16] empate abre prorrogação e administrador inicia o tempo extra', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control, { periodsEnabled: true, periodCount: 1, periodDurationMinutes: 1, overtimeEnabled: true, overtimePeriodCount: 1, overtimePeriodDurationMinutes: 1 });
  await control.advance(60_000);
  await ui.login(g.owner);
  await ui.open('live-match', { matchId: g.match.id });
  await ui.tap('Encerrar 1º tempo');
  await ui.tap('Iniciar 1º tempo da prorrogação');
  await expect.poll(async () => (await live(request, g.match.id, g.owner)).periods.at(-1).periodType).toBe('OVERTIME');
  await ui.sees('1º tempo da prorrogação em andamento.');
});
