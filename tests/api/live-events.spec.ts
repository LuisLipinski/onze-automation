import { test, expect } from '../support/test';
import { liveMatch, generatedMatch, auth, body, live, register, getMatch } from '../support/factory';

test('live start, versioned reads, feeds and score edits require live permission', async ({ request, control }) => {
  const g = await generatedMatch(request, control);
  const path = `/api/matches/${g.match.id}/live`;
  expect((await request.put(path + '/start', { headers: auth(g.members[0]) })).status()).toBe(403);
  await body(await request.put(path + '/start', { headers: auth(g.owner) }));
  const state = await live(request, g.match.id, g.members[0]);
  expect(state.status).toBe('IN_PROGRESS');
  expect((await request.get(path + `?version=${state.version}`, { headers: auth(g.members[0]) })).status()).toBe(204);
  const edited = await body(await request.put(path + '/score', { headers: auth(g.owner), data: { sideNumber: 1, score: 3 } }));
  expect(edited.scores.find((s: any) => s.sideNumber === 1).score).toBe(3);
  expect(edited.version).toBeGreaterThan(state.version);
  expect((await request.put(path + '/score', { headers: auth(g.members[0]), data: { sideNumber: 1, score: 4 } })).status()).toBe(403);
  expect((await request.put(path + '/score', { headers: auth(g.owner), data: { sideNumber: 1, score: -1 } })).status()).toBe(400);
  const feeds = await body(await request.get('/api/matches/live', { headers: auth(g.members[0]) }));
  expect(feeds.some((m: any) => m.matchId === g.match.id)).toBe(true);
  const outsider = await register(request);
  expect(await body(await request.get('/api/matches/live', { headers: auth(outsider) }))).toEqual([]);
  expect((await request.get(path, { headers: auth(outsider) })).status()).toBe(403);
  await body(await request.put(path + '/finish', { headers: auth(g.owner) }));
  expect((await getMatch(request, g.match.id, g.owner)).status).toBe('FINISHED');
  expect((await request.put(path + '/score', { headers: auth(g.owner), data: { sideNumber: 1, score: 4 } })).status()).toBe(409);
  expect((await request.put(path + '/start', { headers: auth(g.owner) })).status()).toBe(409);
});

test('goal/assist and deletion update score and automatic shots atomically', async ({ request, control }) => {
  const g = await liveMatch(request, control);
  const scorer = g.assignments.find(a => a.teamNumber === 1);
  const assist = g.assignments.find(a => a.teamNumber === 1 && a.id !== scorer.id);
  const opponent = g.assignments.find(a => a.teamNumber === 2);
  const path = `/api/matches/${g.match.id}/live`;
  const data = { scorerAssignmentId: scorer.id, assistAssignmentId: assist.id, penalty: false };
  const created = await body(await request.post(path + '/goals', { headers: auth(g.owner), data }), 201);
  expect(created.event).toMatchObject({ scorerAssignmentId: scorer.id, assistAssignmentId: assist.id, ownGoal: false, shotRecorded: true });
  expect(created.liveMatch.scores[0].score).toBe(1);
  expect(created.liveMatch.teamStatistics[0]).toMatchObject({ shots: 1, shotsOnTarget: 1 });
  expect((await request.post(path + '/goals', { headers: auth(g.owner), data: { ...data, assistAssignmentId: opponent.id } })).status()).toBe(400);
  expect((await request.post(path + '/goals', { headers: auth(g.owner), data: { ...data, assistAssignmentId: scorer.id } })).status()).toBe(400);
  const removed = await body(await request.delete(path + `/goals/${created.event.id}`, { headers: auth(g.owner) }));
  expect(removed.scores[0].score).toBe(0);
  expect(removed.goalEvents).toHaveLength(0);
  expect(removed.teamStatistics[0]).toMatchObject({ shots: 0, shotsOnTarget: 0 });
});

test('own goal credits opposing side without personal goal, assist or automatic shot', async ({ request, control }) => {
  const g = await liveMatch(request, control);
  const scorer = g.assignments.find(a => a.teamNumber === 1);
  const path = `/api/matches/${g.match.id}/live`;
  const created = await body(await request.post(path + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: scorer.id, sideNumber: 2, ownGoal: true, penalty: false } }), 201);
  expect(created.event).toMatchObject({ sideNumber: 2, ownGoal: true, shotRecorded: false });
  expect(created.liveMatch.scores[1].score).toBe(1);
  expect((created.liveMatch.teamStatistics.find((s: any) => s.sideNumber === 2)?.shotsOnTarget ?? 0)).toBe(0);
  expect((await request.post(path + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: scorer.id, sideNumber: 1, ownGoal: true, penalty: false } })).status()).toBe(400);
  await body(await request.delete(path + `/goals/${created.event.id}`, { headers: auth(g.owner) }));
  expect((await live(request, g.match.id, g.owner)).scores[1].score).toBe(0);
});

test('shots/corners have player attribution, reject negative totals and protect automatic goal shots', async ({ request, control }) => {
  const g = await liveMatch(request, control);
  const actor = g.assignments.find(a => a.teamNumber === 1);
  const opponent = g.assignments.find(a => a.teamNumber === 2);
  const path = `/api/matches/${g.match.id}/live/team-statistics`;
  const shot = { sideNumber: 1, type: 'SHOTS_ON_TARGET', delta: 1, playerAssignmentId: actor.id };
  let state = await body(await request.post(path, { headers: auth(g.owner), data: shot }));
  expect(state.teamStatistics[0]).toMatchObject({ shots: 1, shotsOnTarget: 1 });
  expect(state.shotEvents[0].playerAssignmentId).toBe(actor.id);
  expect((await request.post(path, { headers: auth(g.owner), data: { ...shot, playerAssignmentId: opponent.id } })).status()).toBe(400);
  state = await body(await request.post(path, { headers: auth(g.owner), data: { ...shot, delta: -1, playerAssignmentId: null } }));
  expect(state.teamStatistics[0]).toMatchObject({ shots: 0, shotsOnTarget: 0 });
  expect((await request.post(path, { headers: auth(g.owner), data: { sideNumber: 1, type: 'SHOTS', delta: -1 } })).status()).toBe(400);
  await body(await request.post(path, { headers: auth(g.owner), data: { sideNumber: 1, type: 'CORNERS', delta: 1 } }));
  state = await body(await request.post(path, { headers: auth(g.owner), data: { sideNumber: 1, type: 'CORNERS', delta: -1 } }));
  expect(state.teamStatistics[0].corners).toBe(0);
  await body(await request.post(`/api/matches/${g.match.id}/live/goals`, { headers: auth(g.owner), data: { scorerAssignmentId: actor.id, penalty: false } }), 201);
  expect((await request.post(path, { headers: auth(g.owner), data: { sideNumber: 1, type: 'SHOTS_ON_TARGET', delta: -1 } })).status()).toBe(400);
});

test('two yellows expel a player, deletion restores eligibility, red cards have the same protection', async ({ request, control }) => {
  const g = await liveMatch(request, control);
  const actor = g.assignments[0];
  const path = `/api/matches/${g.match.id}/live`;
  await body(await request.post(path + '/cards', { headers: auth(g.owner), data: { playerAssignmentId: actor.id, cardType: 'YELLOW' } }), 201);
  const second = await body(await request.post(path + '/cards', { headers: auth(g.owner), data: { playerAssignmentId: actor.id, cardType: 'YELLOW' } }), 201);
  expect((await request.post(path + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: actor.id, penalty: false } })).status()).toBe(400);
  await body(await request.delete(path + `/cards/${second.event.id}`, { headers: auth(g.owner) }));
  await body(await request.post(path + '/goals', { headers: auth(g.owner), data: { scorerAssignmentId: actor.id, penalty: false } }), 201);
  const red = await body(await request.post(path + '/cards', { headers: auth(g.owner), data: { playerAssignmentId: actor.id, cardType: 'RED' } }), 201);
  expect((await request.post(path + '/cards', { headers: auth(g.owner), data: { playerAssignmentId: actor.id, cardType: 'YELLOW' } })).status()).toBe(400);
  await body(await request.delete(path + `/cards/${red.event.id}`, { headers: auth(g.owner) }));
});

test('foul and penalty record opposing victim, later resolution and cascade rollback', async ({ request, control }) => {
  const g = await liveMatch(request, control);
  const offender = g.assignments.find(a => a.teamNumber === 1);
  const victim = g.assignments.find(a => a.teamNumber === 2);
  const path = `/api/matches/${g.match.id}/live`;
  const regular = await body(await request.post(path + '/fouls', { headers: auth(g.owner), data: { offenderAssignmentId: offender.id, victimAssignmentId: victim.id, penalty: false } }), 201);
  expect(regular.teamStatistics[0].fouls).toBe(1);
  await body(await request.delete(path + `/fouls/${regular.foulEvents[0].id}`, { headers: auth(g.owner) }));
  const foul = await body(await request.post(path + '/fouls', { headers: auth(g.owner), data: { offenderAssignmentId: offender.id, victimAssignmentId: victim.id, penalty: true } }), 201);
  const event = foul.foulEvents[0];
  expect(event).toMatchObject({ offenderSideNumber: 1, victimSideNumber: 2, scored: null, goalEventId: null });
  expect((await request.post(path + `/fouls/${event.id}/resolve`, { headers: auth(g.owner), data: { takerAssignmentId: offender.id, scored: true } })).status()).toBe(400);
  await control.advance(30000);
  const resolved = await body(await request.post(path + `/fouls/${event.id}/resolve`, { headers: auth(g.owner), data: { takerAssignmentId: victim.id, scored: true } }));
  expect(resolved.scores[1].score).toBe(1);
  expect(resolved.foulEvents[0]).toMatchObject({ scored: true, goalEventId: expect.any(String), resolutionElapsedSeconds: 30 });
  expect(resolved.goalEvents[0].penalty).toBe(true);
  const removed = await body(await request.delete(path + `/fouls/${event.id}`, { headers: auth(g.owner) }));
  expect(removed.goalEvents).toHaveLength(0);
  expect(removed.foulEvents).toHaveLength(0);
  expect(removed.scores[1].score).toBe(0);
  expect(removed.teamStatistics[1].shotsOnTarget).toBe(0);
});

test('missed penalty records attempt without goal and reset clears all live state', async ({ request, control }) => {
  const g = await liveMatch(request, control);
  const offender = g.assignments.find(a => a.teamNumber === 1);
  const victim = g.assignments.find(a => a.teamNumber === 2);
  const path = `/api/matches/${g.match.id}/live`;
  const created = await body(await request.post(path + '/fouls', { headers: auth(g.owner), data: { offenderAssignmentId: offender.id, victimAssignmentId: victim.id, penalty: true } }), 201);
  const resolved = await body(await request.post(path + `/fouls/${created.foulEvents[0].id}/resolve`, { headers: auth(g.owner), data: { takerAssignmentId: victim.id, scored: false } }));
  expect(resolved.foulEvents[0].scored).toBe(false);
  expect(resolved.goalEvents).toHaveLength(0);
  await body(await request.put(path + '/reset', { headers: auth(g.owner) }));
  const reset = await live(request, g.match.id, g.owner);
  expect(reset.status).toBe('SCHEDULED');
  expect(reset.goalEvents).toHaveLength(0);
  expect(reset.foulEvents).toHaveLength(0);
  expect(reset.cardEvents).toHaveLength(0);
});

test('three-hour automatic finish fixes finishedAt and blocks further live writes', async ({ request, control }) => {
  const g = await liveMatch(request, control);
  const before = await live(request, g.match.id, g.owner);
  const end = new Date(Date.parse(before.startedAt) + 3 * 3600000).toISOString();
  await control.at(new Date(Date.parse(end) + 60000).toISOString());
  await control.process();
  const after = await live(request, g.match.id, g.owner);
  expect(after.status).toBe('FINISHED');
  expect(Date.parse(after.finishedAt)).toBe(Date.parse(end));
  expect((await request.put(`/api/matches/${g.match.id}/live/score`, { headers: auth(g.owner), data: { sideNumber: 1, score: 1 } })).status()).toBe(409);
});
