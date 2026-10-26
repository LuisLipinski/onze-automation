import { test, expect } from '../support/test';
import { group, createMatch, auth, body } from '../support/factory';

test('explicitly enabled tools generate/reuse players, apply scenarios and add/remove attendance', async ({ request, control }) => {
  const g = await group(request, 1);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 14 });
  expect(match.canManageTestData).toBe(true);
  const path = `/api/dev/test-data/matches/${match.id}`;
  const initial = await body(await request.get(path, { headers: auth(g.owner) }));
  expect(initial.testPlayers).toBe(0);
  expect((await request.post(path + '/generate', { headers: auth(g.members[0]), data: { count: 6 } })).status()).toBe(403);
  expect((await request.post(path + '/generate', { headers: auth(g.owner), data: { count: 41 } })).status()).toBe(400);
  const generated = await body(await request.post(path + '/generate', { headers: auth(g.owner), data: { count: 6 } }));
  expect(generated.created).toBe(6);
  const reused = await body(await request.post(path + '/generate', { headers: auth(g.owner), data: { count: 6 } }));
  expect(reused).toMatchObject({ created: 0, reused: 6 });
  for (const scenario of ['BALANCED','ATTACK_VS_DEFENSE','UNEVEN','SPECIALISTS','SECONDARY_POSITIONS','GOALKEEPER_PRIORITY']) {
    const applied = await body(await request.put(path + '/scenario', { headers: auth(g.owner), data: { scenario } }));
    expect(applied).toMatchObject({ scenario, updatedPlayers: 6 });
  }
  const added = await body(await request.post(path + '/attendance', { headers: auth(g.owner) }));
  expect(added.added).toBe(6);
  const again = await body(await request.post(path + '/attendance', { headers: auth(g.owner) }));
  expect(again).toMatchObject({ added: 0, alreadyGoing: 6 });
  const removed = await body(await request.delete(path + '/attendance', { headers: auth(g.owner) }));
  expect(removed.removed).toBe(6);
  const final = await body(await request.get(path, { headers: auth(g.owner) }));
  expect(final.testPlayersGoing).toBe(0);
});
