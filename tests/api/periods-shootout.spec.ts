import { test, expect } from '../support/test';
import { liveMatch, live, auth, body } from '../support/factory';

for (const periodCount of [1,2,3,4]) test(`${periodCount} regulation periods finish only after configured durations`, async ({ request, control }) => {
  const g = await liveMatch(request, control, { periodsEnabled: true, periodCount, periodDurationMinutes: 1 });
  const path = `/api/matches/${g.match.id}/live/period`;
  expect((await request.put(path + '/finish', { headers: auth(g.owner) })).status()).toBe(409);
  for (let number = 1; number <= periodCount; number++) {
    const before = await live(request, g.match.id, g.owner);
    expect(before.periods.at(-1).periodNumber).toBe(number);
    await control.advance(60000);
    const after = await body(await request.put(path + '/finish', { headers: auth(g.owner) }));
    if (number < periodCount) {
      expect(after.status).toBe('IN_PROGRESS');
      expect((await request.post(`/api/matches/${g.match.id}/live/goals`, { headers: auth(g.owner), data: { scorerAssignmentId: g.assignments[0].id, penalty: false } })).status()).toBe(409);
      await body(await request.put(path + '/start-next', { headers: auth(g.owner) }));
    } else expect(after.status).toBe('FINISHED');
  }
});

test('added time is enforced and tied regulation enters overtime before finishing', async ({ request, control }) => {
  const g = await liveMatch(request, control, { periodsEnabled: true, periodCount: 1, periodDurationMinutes: 1, overtimeEnabled: true, overtimePeriodCount: 2, overtimePeriodDurationMinutes: 1 });
  const path = `/api/matches/${g.match.id}/live/period`;
  await body(await request.put(path + '/added-time', { headers: auth(g.owner), data: { minutes: 2 } }));
  expect((await request.put(path + '/added-time', { headers: auth(g.owner), data: { minutes: 181 } })).status()).toBe(400);
  await control.advance(60000);
  expect((await request.put(path + '/finish', { headers: auth(g.owner) })).status()).toBe(409);
  await control.advance(120000);
  await body(await request.put(path + '/finish', { headers: auth(g.owner) }));
  let state = await body(await request.put(path + '/start-next', { headers: auth(g.owner) }));
  expect(state.periods.at(-1).periodType).toBe('OVERTIME');
  for (let number = 1; number <= 2; number++) {
    await control.advance(60000);
    state = await body(await request.put(path + '/finish', { headers: auth(g.owner) }));
    if (number < 2) await body(await request.put(path + '/start-next', { headers: auth(g.owner) }));
  }
  expect(state.status).toBe('FINISHED');
});

test('untied regulation skips overtime and penalties', async ({ request, control }) => {
  const g = await liveMatch(request, control, { periodsEnabled: true, periodCount: 1, periodDurationMinutes: 1, overtimeEnabled: true, overtimePeriodCount: 2, overtimePeriodDurationMinutes: 1, penaltyShootoutEnabled: true });
  await body(await request.post(`/api/matches/${g.match.id}/live/goals`, { headers: auth(g.owner), data: { scorerAssignmentId: g.assignments.find(a => a.teamNumber === 1).id, penalty: false } }), 201);
  await control.advance(60000);
  const state = await body(await request.put(`/api/matches/${g.match.id}/live/period/finish`, { headers: auth(g.owner) }));
  expect(state.status).toBe('FINISHED');
  expect(state.periods).toHaveLength(1);
  expect(state.penaltyShootout).toBeNull();
});

test('shootout alternates kicks, enters sudden death and only finishes on winner confirmation', async ({ request, control }) => {
  const g = await liveMatch(request, control, { periodsEnabled: true, periodCount: 1, periodDurationMinutes: 1, penaltyShootoutEnabled: true });
  const path = `/api/matches/${g.match.id}/live`;
  await control.advance(60000);
  const setup = await body(await request.put(path + '/period/finish', { headers: auth(g.owner) }));
  expect(setup.penaltyShootout.status).toBe('SETUP');
  expect((await request.put(path + '/penalties/confirm-winner', { headers: auth(g.owner) })).status()).toBe(409);
  const takers = [1,2].flatMap(teamNumber => [1,2,3,4,5].map(kickOrder => ({ teamNumber, kickOrder, displayName: `Batedor ${teamNumber}-${kickOrder}` })));
  expect((await request.put(path + '/penalties/lineup', { headers: auth(g.owner), data: { takers: takers.slice(0,9) } })).status()).toBe(400);
  let state = await body(await request.put(path + '/penalties/lineup', { headers: auth(g.owner), data: { takers } }));
  for (let index = 0; index < 10; index++) {
    expect(state.penaltyShootout.nextTeamNumber).toBe(index % 2 + 1);
    state = await body(await request.post(path + '/penalties/attempts', { headers: auth(g.owner), data: { scored: true } }));
  }
  expect(state.penaltyShootout.nextTakerSelectionRequired).toBe(true);
  state = await body(await request.post(path + '/penalties/attempts', { headers: auth(g.owner), data: { scored: true, takerDisplayName: 'Extra Preto' } }));
  state = await body(await request.post(path + '/penalties/attempts', { headers: auth(g.owner), data: { scored: false, takerDisplayName: 'Extra Branco' } }));
  expect(state.penaltyShootout).toMatchObject({ status: 'AWAITING_CONFIRMATION', winnerTeamNumber: 1, teamOneScore: 6, teamTwoScore: 5 });
  expect(state.status).toBe('IN_PROGRESS');
  expect(state.goalEvents).toHaveLength(0);
  expect(state.scores.every((s: any) => s.score === 0)).toBe(true);
  const confirmed = await body(await request.put(path + '/penalties/confirm-winner', { headers: auth(g.owner) }));
  expect(confirmed.status).toBe('FINISHED');
  expect(confirmed.penaltyShootout.status).toBe('COMPLETED');
  const stats = await body(await request.get(`/api/groups/${g.id}/statistics`, { headers: auth(g.owner) }));
  expect(stats.registeredGoals).toBe(0);
  expect(stats.players.every((p: any) => p.totals.goals === 0)).toBe(true);
});

test('shootout can end early once the losing side cannot catch up', async ({ request, control }) => {
  const g = await liveMatch(request, control, { periodsEnabled: true, periodCount: 1, periodDurationMinutes: 1, penaltyShootoutEnabled: true });
  const path = `/api/matches/${g.match.id}/live`;
  await control.advance(60000);
  await body(await request.put(path + '/period/finish', { headers: auth(g.owner) }));
  const takers = [1,2].flatMap(teamNumber => [1,2,3,4,5].map(kickOrder => ({ teamNumber, kickOrder, displayName: `Batedor ${teamNumber}-${kickOrder}` })));
  await body(await request.put(path + '/penalties/lineup', { headers: auth(g.owner), data: { takers } }));
  let state: any;
  for (const scored of [true,false,true,false,true,false]) state = await body(await request.post(path + '/penalties/attempts', { headers: auth(g.owner), data: { scored } }));
  expect(state.penaltyShootout).toMatchObject({ status: 'AWAITING_CONFIRMATION', winnerTeamNumber: 1 });
  expect((await request.post(path + '/penalties/attempts', { headers: auth(g.owner), data: { scored: true } })).status()).toBe(409);
});
