import { test, expect } from '../support/test';
import { liveMatch, createMatch, auth, body, going, generatedMatch, register } from '../support/factory';

test('only finished matches enter statistics and goals/assists use the corrected source events', async ({ request, control }) => {
  const g = await liveMatch(request, control);
  const scorer = g.assignments.find(a => a.teamNumber === 1);
  const assist = g.assignments.find(a => a.teamNumber === 1 && a.id !== scorer.id);
  const opponent = g.assignments.find(a => a.teamNumber === 2);
  const base = `/api/matches/${g.match.id}/live`;
  const goal = await body(await request.post(base + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: scorer.id, assistAssignmentId: assist.id, penalty: false } }), 201);
  const discarded = await body(await request.post(base + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: scorer.id, penalty: false } }), 201);
  await body(await request.delete(base + `/goals/${discarded.event.id}`, { headers: auth(g.owner) }));
  await body(await request.post(base + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: opponent.id, sideNumber: 1, ownGoal: true, penalty: false } }), 201);
  const statistics = `/api/groups/${g.id}/statistics`;
  expect((await body(await request.get(statistics, { headers: auth(g.owner) }))).finishedMatches).toBe(0);
  await body(await request.put(base + '/finish', { headers: auth(g.owner) }));
  const group = await body(await request.get(statistics, { headers: auth(g.owner) }));
  expect(group.finishedMatches).toBe(1);
  expect(group.players.find((p: any) => p.userId === scorer.participantId).totals).toMatchObject({ gamesPlayed: 1, goals: 1, wins: 1 });
  expect(group.players.find((p: any) => p.userId === assist.participantId).totals.assists).toBe(1);
  expect(group.players.find((p: any) => p.userId === opponent.participantId).totals).toMatchObject({ goals: 0, losses: 1 });
  const personal = await body(await request.get(statistics + `/players/${scorer.participantId}`, { headers: auth(g.members[0]) }));
  expect(personal.matchHistory).toHaveLength(1);
  expect(personal.matchHistory[0]).toMatchObject({ matchId: g.match.id, goals: 1, result: 'WIN' });
  expect(group.rankings.losses.some((r: any) => r.userId === opponent.participantId)).toBe(true);
  const outsider = await register(request);
  expect((await request.get(statistics, { headers: auth(outsider) })).status()).toBe(403);
  expect((await request.get(statistics + `/players/${scorer.participantId}`, { headers: auth(outsider) })).status()).toBe(403);
});

test('goal ranking breaks equal goals by assists and assist ranking by goals', async ({ request, control }) => {
  const g = await generatedMatch(request, control);
  const [a,b] = g.assignments.filter(p => p.assignedRole !== 'GOALKEEPER');
  await body(await request.put(`/api/matches/${g.match.id}/teams/assignments/${b.id}`, { headers: auth(g.owner), data: { teamNumber: a.teamNumber, assignedRole: 'PIVOT' } }));
  const base = `/api/matches/${g.match.id}/live`;
  await body(await request.put(base + '/start', { headers: auth(g.owner) }));
  for (const data of [
    { scorerAssignmentId: a.id, assistAssignmentId: b.id },
    { scorerAssignmentId: a.id, assistAssignmentId: b.id },
    { scorerAssignmentId: b.id, assistAssignmentId: a.id },
    { scorerAssignmentId: b.id },
  ]) await body(await request.post(base + '/goals', { headers: auth(g.owner), data: { ...data, penalty: false } }), 201);
  await body(await request.put(base + '/finish', { headers: auth(g.owner) }));
  const first = await body(await request.get(`/api/groups/${g.id}/statistics`, { headers: auth(g.owner) }));
  expect(first.rankings.goals.map((p: any) => p.userId).indexOf(b.participantId)).toBeLessThan(first.rankings.goals.map((p: any) => p.userId).indexOf(a.participantId));
  // A second finished occurrence gives A one extra goal and assist: equal assists, A ahead on goals.
  const next = await createMatch(request, control, g.id, g.owner);
  for (const actor of g.actors) await going(request, next.id, actor);
  const teams = await body(await request.post(`/api/matches/${next.id}/teams/generate`, { headers: auth(g.owner) }));
  const assignments = teams.teams.flatMap((t: any) => t.assignments.map((p: any) => ({ ...p, teamNumber: t.teamNumber })));
  const nextA = assignments.find((p: any) => p.participantId === a.participantId);
  const nextB = assignments.find((p: any) => p.participantId === b.participantId);
  await body(await request.put(`/api/matches/${next.id}/teams/assignments/${nextB.id}`, { headers: auth(g.owner), data: { teamNumber: nextA.teamNumber, assignedRole: 'PIVOT' } }));
  const nextBase = `/api/matches/${next.id}/live`;
  await body(await request.put(nextBase + '/start', { headers: auth(g.owner) }));
  await body(await request.post(nextBase + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: nextA.id, penalty: false } }), 201);
  const keeper = assignments.find((p: any) => p.assignedRole === 'GOALKEEPER' && p.teamNumber === nextA.teamNumber);
  await body(await request.post(nextBase + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: keeper.id, assistAssignmentId: nextA.id, penalty: false } }), 201);
  await body(await request.put(nextBase + '/finish', { headers: auth(g.owner) }));
  const second = await body(await request.get(`/api/groups/${g.id}/statistics`, { headers: auth(g.owner) }));
  const order = second.rankings.assists.map((p: any) => p.userId);
  expect(order.indexOf(a.participantId)).toBeLessThan(order.indexOf(b.participantId));
});

test('new season starts empty, general accumulates and closed season/history remain frozen', async ({ request, control }) => {
  const g = await liveMatch(request, control);
  const base = `/api/groups/${g.id}/statistics`;
  const shooter = g.assignments[0];
  await body(await request.post(`/api/matches/${g.match.id}/live/goals`, { headers: auth(g.owner), data: { scorerAssignmentId: shooter.id, penalty: false } }), 201);
  await body(await request.put(`/api/matches/${g.match.id}/live/finish`, { headers: auth(g.owner) }));
  const before = await body(await request.get(base, { headers: auth(g.owner) }));
  const firstSeason = before.seasons.find((s: any) => s.endedAt === null);
  const firstSnapshot = await body(await request.get(base + `?seasonId=${firstSeason.id}`, { headers: auth(g.owner) }));
  await control.advance(1000);
  expect((await request.post(base + '/seasons', { headers: auth(g.members[0]), data: { expectedCurrentSeasonId: firstSeason.id } })).status()).toBe(403);
  const secondSeason = await body(await request.post(base + '/seasons', { headers: auth(g.owner), data: { expectedCurrentSeasonId: firstSeason.id } }), 201);
  expect((await body(await request.get(base + `?seasonId=${secondSeason.id}`, { headers: auth(g.owner) }))).finishedMatches).toBe(0);
  expect((await request.post(base + '/seasons', { headers: auth(g.owner), data: { expectedCurrentSeasonId: firstSeason.id } })).status()).toBe(409);
  const next = await createMatch(request, control, g.id, g.owner);
  for (const actor of g.actors) await going(request, next.id, actor);
  await body(await request.post(`/api/matches/${next.id}/teams/generate`, { headers: auth(g.owner) }));
  await body(await request.put(`/api/matches/${next.id}/live/start`, { headers: auth(g.owner) }));
  await body(await request.put(`/api/matches/${next.id}/live/finish`, { headers: auth(g.owner) }));
  const general = await body(await request.get(base, { headers: auth(g.owner) }));
  expect(general.finishedMatches).toBe(2);
  const closed = await body(await request.get(base + `?seasonId=${firstSeason.id}`, { headers: auth(g.owner) }));
  expect(closed.finishedMatches).toBe(firstSnapshot.finishedMatches);
  expect(closed.rankings).toEqual(firstSnapshot.rankings);
  expect(closed.matchHistory).toEqual(firstSnapshot.matchHistory);
  const history = await body(await request.get(base + `/players/${shooter.participantId}?seasonId=${firstSeason.id}`, { headers: auth(g.owner) }));
  expect(history.matchHistory).toHaveLength(1);
  expect((await body(await request.get(base + `?seasonId=${secondSeason.id}`, { headers: auth(g.owner) }))).finishedMatches).toBe(1);
  expect((await request.get(base + '?seasonId=00000000-0000-4000-8000-000000000001', { headers: auth(g.owner) })).status()).toBe(404);
});

test('games rank uses wins; wins/goals/assists resolve remaining ties by games played', async ({ request, control }) => {
  const g = await generatedMatch(request, control);
  const a = g.members[1], b = g.members[2];
  const statistics = `/api/groups/${g.id}/statistics`;
  const configure = async (id: string, includeB = true) => {
    const teams = await body(await request.get(`/api/matches/${id}/teams`, { headers: auth(g.owner) }));
    const assignments = teams.teams.flatMap((t: any) => t.assignments.map((p: any) => ({ ...p, teamNumber: t.teamNumber })));
    for (const [actor, side] of [[a, includeB ? 1 : 2], [b, 2]] as const) {
      if (!includeB && actor === b) continue;
      const assignment = assignments.find((p: any) => p.participantId === actor.user.id);
      await body(await request.put(`/api/matches/${id}/teams/assignments/${assignment.id}`, { headers: auth(g.owner), data: { teamNumber: side, assignedRole: 'PIVOT' } }));
      assignment.teamNumber = side;
    }
    await body(await request.put(`/api/matches/${id}/live/start`, { headers: auth(g.owner) }));
    return assignments;
  };
  const goal = async (id: string, scorer: any, assist?: any) => body(await request.post(`/api/matches/${id}/live/goals`, { headers: auth(g.owner), data: { scorerAssignmentId: scorer.id, assistAssignmentId: assist?.id, penalty: false } }), 201);
  let assignments = await configure(g.match.id);
  const firstA = assignments.find((p: any) => p.participantId === a.user.id);
  const firstB = assignments.find((p: any) => p.participantId === b.user.id);
  await goal(g.match.id, firstA);
  await goal(g.match.id, assignments.find((p: any) => p.assignedRole === 'GOALKEEPER' && p.teamNumber === 1), firstA);
  await goal(g.match.id, assignments.find((p: any) => p.assignedRole === 'GOALKEEPER' && p.teamNumber === 2), firstB);
  await body(await request.put(`/api/matches/${g.match.id}/live/finish`, { headers: auth(g.owner) }));
  let stats = await body(await request.get(statistics, { headers: auth(g.owner) }));
  let order = stats.rankings.gamesPlayed.map((p: any) => p.userId);
  expect(order.indexOf(a.user.id)).toBeLessThan(order.indexOf(b.user.id));
  const second = await createMatch(request, control, g.id, g.owner);
  for (const actor of g.actors) await going(request, second.id, actor);
  await body(await request.post(`/api/matches/${second.id}/teams/generate`, { headers: auth(g.owner) }));
  assignments = await configure(second.id);
  await goal(second.id, assignments.find((p: any) => p.participantId === b.user.id));
  await body(await request.put(`/api/matches/${second.id}/live/finish`, { headers: auth(g.owner) }));
  stats = await body(await request.get(statistics, { headers: auth(g.owner) }));
  for (const metric of ['goals','assists']) expect(stats.rankings[metric].find((p: any) => p.userId === a.user.id).rank).toBe(stats.rankings[metric].find((p: any) => p.userId === b.user.id).rank);
  const third = await createMatch(request, control, g.id, g.owner);
  for (const actor of [g.owner, g.members[0], a]) await going(request, third.id, actor);
  await body(await request.post(`/api/matches/${third.id}/teams/generate`, { headers: auth(g.owner) }));
  assignments = await configure(third.id, false);
  await goal(third.id, assignments.find((p: any) => p.assignedRole === 'GOALKEEPER' && p.teamNumber === 1));
  await body(await request.put(`/api/matches/${third.id}/live/finish`, { headers: auth(g.owner) }));
  stats = await body(await request.get(statistics, { headers: auth(g.owner) }));
  expect(stats.players.find((p: any) => p.userId === a.user.id).totals).toMatchObject({ gamesPlayed: 3, wins: 1, losses: 2, goals: 1, assists: 1 });
  expect(stats.players.find((p: any) => p.userId === b.user.id).totals).toMatchObject({ gamesPlayed: 2, wins: 1, losses: 1, goals: 1, assists: 1 });
  for (const metric of ['wins','goals','assists','losses']) {
    order = stats.rankings[metric].map((p: any) => p.userId);
    expect(order.indexOf(a.user.id), metric).toBeLessThan(order.indexOf(b.user.id));
  }
  const cancelled = await createMatch(request, control, g.id, g.owner);
  for (const actor of g.actors) await going(request, cancelled.id, actor);
  await body(await request.delete(`/api/matches/${cancelled.id}`, { headers: auth(g.owner) }), 204);
  expect((await body(await request.get(statistics, { headers: auth(g.owner) }))).finishedMatches).toBe(3);
});
