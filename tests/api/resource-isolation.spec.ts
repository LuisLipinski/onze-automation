import { test, expect } from '../support/test';
import { generatedMatch, liveMatch, auth, body, ratings, register } from '../support/factory';

test('member of another group cannot read or mutate match domains', async ({ request, control }) => {
  const g = await generatedMatch(request, control);
  const foreign = await register(request);
  for (const suffix of ['', '/live', '/share', '/teams', '/teams/images', '/teams/reserves', '/minimum-player-decision']) {
    const response = await request.get(`/api/matches/${g.match.id}${suffix}`, { headers: auth(foreign) });
    expect(response.status(), suffix).toBe(403);
  }
  expect((await request.put(`/api/matches/${g.match.id}/attendance`, { headers: auth(foreign), data: { status: 'GOING' } })).status()).toBe(403);
  expect((await request.put(`/api/matches/${g.match.id}/live/start`, { headers: auth(foreign) })).status()).toBe(403);
  expect((await request.get(`/api/groups/${g.id}/credits`, { headers: auth(foreign) })).status()).toBe(403);
  expect((await request.get(`/api/groups/${g.id}/matches`, { headers: auth(foreign) })).status()).toBe(403);
});

test('foreign event/assignment/guest identifiers cannot be used in an authorized different match', async ({ request, control }) => {
  const first = await liveMatch(request, control);
  const second = await liveMatch(request, control);
  const player = first.assignments[0];
  const base = `/api/matches/${first.match.id}/live`;
  const goal = await body(await request.post(base + '/goals', { headers: auth(first.owner), data: { scorerAssignmentId: player.id, penalty: false } }), 201);
  const card = await body(await request.post(base + '/cards', { headers: auth(first.owner), data: { playerAssignmentId: player.id, cardType: 'YELLOW' } }), 201);
  expect((await request.delete(`/api/matches/${second.match.id}/live/goals/${goal.event.id}`, { headers: auth(second.owner) })).status()).toBe(404);
  expect((await request.delete(`/api/matches/${second.match.id}/live/cards/${card.event.id}`, { headers: auth(second.owner) })).status()).toBe(404);
  expect((await request.put(`/api/matches/${second.match.id}/teams/assignments/${player.id}`, { headers: auth(second.owner), data: { teamNumber: 1, assignedRole: 'PIVOT' } })).status()).toBe(404);
  const current = await body(await request.get(base, { headers: auth(first.owner) }));
  expect(current.goalEvents).toHaveLength(1);
  expect(current.cardEvents).toHaveLength(1);
});

test('minimum-player decisions consistently reject outsiders and unknown matches', async ({ request, control }) => {
  const g = await generatedMatch(request, control);
  const foreign = await register(request);
  const data = { signupDeadlineDate: '2099-01-01', signupDeadlineTime: '18:00:00' };
  for (const suffix of ['', '/approve', '/extend']) {
    const method = suffix ? 'PUT' : 'GET';
    const denied = await request.fetch(`/api/matches/${g.match.id}/minimum-player-decision${suffix}`, { method, headers: auth(foreign), data: suffix ? data : undefined });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe('GROUP_ACCESS_DENIED');
    const missing = await request.fetch(`/api/matches/00000000-0000-4000-8000-000000000001/minimum-player-decision${suffix}`, { method, headers: auth(g.owner), data: suffix ? data : undefined });
    expect(missing.status()).toBe(404);
    expect((await missing.json()).code).toBe('MATCH_NOT_FOUND');
  }
});
