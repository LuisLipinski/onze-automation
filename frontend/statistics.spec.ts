import { test, expect } from './support/test';
import { auth, body, createMatch, generatedMatch, going, group, liveMatch } from './support/factory';

test('[UI-S01] rankings mostram todas as métricas e critérios de desempate', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  const [scorer, assist] = g.assignments.filter(a => a.teamNumber === 1);
  await body(await request.post(`/api/matches/${g.match.id}/live/goals`, { headers: auth(g.owner), data: { scorerAssignmentId: scorer.id, assistAssignmentId: assist.id, penalty: false } }), 201);
  await body(await request.put(`/api/matches/${g.match.id}/live/finish`, { headers: auth(g.owner) }));
  await ui.login(g.owner);
  await ui.open('group-statistics', { groupId: g.id });
  await ui.screen('group-statistics', 'Estatísticas');
  await ui.sees('Ranking do grupo');
  await ui.tap('Artilharia');
  await ui.sees('Desempate: mais assistências, depois mais jogos disputados.', true);
  await ui.tap('Assistências');
  await ui.sees('Desempate: mais gols, depois mais jogos disputados.', true);
  await ui.tap('Jogos');
  await ui.sees('Desempate: mais vitórias.', true);
  for (const label of ['Vitórias', 'Derrotas', 'Faltas feitas', 'Faltas sofridas', 'Pênaltis cometidos', 'Pênaltis sofridos', 'Pênaltis cobrados', 'Pênaltis convertidos', 'Pênaltis perdidos']) {
    await ui.tap(label);
    await ui.sees('#1');
  }
  await ui.tabs();
});

test('[UI-S02] temporada encerra histórico, começa zerada e geral mantém resultado', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  await body(await request.put(`/api/matches/${g.match.id}/live/finish`, { headers: auth(g.owner) }));
  await control.advance(1000);
  await ui.login(g.owner);
  await ui.open('group-statistics', { groupId: g.id });
  await ui.tap('Iniciar nova temporada');
  await ui.has('Iniciar nova temporada?');
  await ui.has('todos os valores zerados', true);
  await ui.tap('Cancelar');
  await ui.tap('Iniciar nova temporada');
  await ui.tap('Iniciar temporada');
  await ui.sees('Temporada 2 · atual');
  await ui.sees('O primeiro ranking começa no apito final');
  await ui.tap('Selecionar ranking geral ou temporada');
  await ui.tap('Temporada 1 · encerrada');
  await ui.sees('Temporada encerrada:', true);
  await ui.sees('Ranking do grupo');
  await ui.tap('Selecionar ranking geral ou temporada');
  await ui.tap('Geral · acumulado');
  await ui.sees('O geral acumula todo o histórico', true);
  expect((await body(await request.get(`/api/groups/${g.id}/statistics`, { headers: auth(g.owner) }))).finishedMatches).toBe(1);
});

test('[UI-S03] histórico pessoal abre jogo encerrado e preserva equipe do jogador', async ({ ui, request, control }) => {
  const g = await liveMatch(request, control);
  await body(await request.put(`/api/matches/${g.match.id}/live/finish`, { headers: auth(g.owner) }));
  await ui.login(g.owner);
  await ui.open('player-statistics', { groupId: g.id, userId: g.owner.user.id });
  await ui.screen('player-statistics', 'SEU HISTÓRICO');
  await ui.sees('Arena QA', true);
  await ui.tap('Ver jogo', true);
  await ui.has('Jogo ao vivo');
  await ui.sees('FINALIZADA');
});

test('[UI-S04] estatísticas vazias e membro não pode iniciar temporada', async ({ ui, request }) => {
  const g = await group(request, 1);
  await ui.login(g.members[0]);
  await ui.open('group-statistics', { groupId: g.id });
  await ui.sees('O primeiro ranking começa no apito final');
  await ui.absent('Iniciar nova temporada');
  await ui.tap('Ver histórico');
  await ui.sees('SEU HISTÓRICO');
  await ui.tabs();
});

test('[UI-S05] posições reais do ranking desempataram gols por assistências e assistências por gols', async ({ ui, request, control }) => {
  const g = await generatedMatch(request, control);
  const [a, b] = g.assignments.filter(p => p.assignedRole !== 'GOALKEEPER');
  await body(await request.put(`/api/matches/${g.match.id}/teams/assignments/${b.id}`, { headers: auth(g.owner), data: { teamNumber: a.teamNumber, assignedRole: 'PIVOT' } }));
  const path = `/api/matches/${g.match.id}/live`;
  await body(await request.put(path + '/start', { headers: auth(g.owner) }));
  for (const data of [
    { scorerAssignmentId: a.id, assistAssignmentId: b.id },
    { scorerAssignmentId: a.id, assistAssignmentId: b.id },
    { scorerAssignmentId: b.id, assistAssignmentId: a.id },
    { scorerAssignmentId: b.id },
  ]) await body(await request.post(path + '/goals', { headers: auth(g.owner), data: { ...data, penalty: false } }), 201);
  await body(await request.put(path + '/finish', { headers: auth(g.owner) }));
  await ui.login(g.owner);
  await ui.open('group-statistics', { groupId: g.id });
  await ui.tap('Artilharia');
  await ui.rankedPlayer(1, b.displayName);
  await ui.rankedPlayer(2, a.displayName);

  const next = await createMatch(request, control, g.id, g.owner);
  for (const actor of g.actors) await going(request, next.id, actor);
  const generated = await body(await request.post(`/api/matches/${next.id}/teams/generate`, { headers: auth(g.owner) }));
  const assignments = generated.teams.flatMap((t: any) => t.assignments.map((p: any) => ({ ...p, teamNumber: t.teamNumber })));
  const nextA = assignments.find((p: any) => p.participantId === a.participantId);
  const keeper = assignments.find((p: any) => p.assignedRole === 'GOALKEEPER' && p.teamNumber === nextA.teamNumber);
  const secondPath = `/api/matches/${next.id}/live`;
  await body(await request.put(secondPath + '/start', { headers: auth(g.owner) }));
  await body(await request.post(secondPath + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: nextA.id, penalty: false } }), 201);
  await body(await request.post(secondPath + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: keeper.id, assistAssignmentId: nextA.id, penalty: false } }), 201);
  await body(await request.put(secondPath + '/finish', { headers: auth(g.owner) }));
  const stats = await body(await request.get(`/api/groups/${g.id}/statistics`, { headers: auth(g.owner) }));
  expect(stats.players.find((p: any) => p.userId === a.participantId).totals).toMatchObject({ goals: 3, assists: 2 });
  expect(stats.players.find((p: any) => p.userId === b.participantId).totals).toMatchObject({ goals: 2, assists: 2 });
  await ui.tap('Home');
  await ui.open('group-statistics', { groupId: g.id });
  await ui.tap('Assistências');
  await ui.rankedPlayer(1, a.displayName);
  await ui.rankedPlayer(2, b.displayName);
});
