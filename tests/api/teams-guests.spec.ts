import { test, expect } from '../support/test';
import { group, createMatch, preparedMatch, generatedMatch, auth, body, going, profile, promote, ratings, png } from '../support/factory';

test('guest technical profile has separate permissions, validates all skills and is removed cleanly', async ({ request, control }) => {
  const g = await group(request, 1);
  await promote(request, g.id, g.owner, g.members[0], ['MANAGE_MATCH_PLAYERS']);
  const match = await createMatch(request, control, g.id, g.owner);
  const path = `/api/matches/${match.id}/guests`;
  expect((await request.post(path, { headers: auth(g.members[0]), data: { displayName: 'Convidado avaliado', primaryPosition: 'MIDFIELDER', ratings: ratings() } })).status()).toBe(403);
  const state = await body(await request.post(path, { headers: auth(g.members[0]), data: { displayName: 'Convidado', primaryPosition: 'MIDFIELDER', secondaryPosition: 'DEFENDER' } }));
  const guest = state.guests[0];
  const technical = `${path}/${guest.id}/technical-profile`;
  expect((await request.get(technical, { headers: auth(g.members[0]) })).status()).toBe(403);
  await body(await request.put(technical, { headers: auth(g.owner), data: { ratings: ratings(9) } }));
  expect((await body(await request.get(technical, { headers: auth(g.owner) }))).ratings).toEqual(ratings(9));
  expect((await request.put(technical, { headers: auth(g.owner), data: { ratings: { FINISHING: 11 } } })).status()).toBe(400);
  const removed = await body(await request.delete(`${path}/${guest.id}`, { headers: auth(g.members[0]) }));
  expect(removed.guests).toHaveLength(0);
  expect((await request.get(technical, { headers: auth(g.owner) })).status()).toBe(404);
});

test('generated teams preserve participant uniqueness, keeper distribution and private technical values', async ({ request, control }) => {
  const g = await generatedMatch(request, control);
  expect(g.teams.teams).toHaveLength(2);
  expect(g.teams.confirmedPlayers).toBe(4);
  expect(new Set(g.assignments.map(a => a.participantId)).size).toBe(4);
  expect(g.teams.teams.every((t: any) => t.assignments.filter((a: any) => a.assignedRole === 'GOALKEEPER').length === 1)).toBe(true);
  const viewed = await body(await request.get(`/api/matches/${g.match.id}/teams`, { headers: auth(g.members[1]) }));
  expect(viewed.technicalDetailsVisible).toBe(false);
  expect(viewed.teams.every((t: any) => t.estimatedStrength === null && t.assignments.every((a: any) => a.overallUsed === null))).toBe(true);
  expect((await request.post(`/api/matches/${g.match.id}/teams/generate`, { headers: auth(g.members[0]) })).status()).toBe(403);
  const field = g.assignments.find(a => a.assignedRole !== 'GOALKEEPER');
  const updated = await body(await request.put(`/api/matches/${g.match.id}/teams/assignments/${field.id}`, { headers: auth(g.owner), data: { teamNumber: field.teamNumber, assignedRole: 'PIVOT' } }));
  expect(updated.teams.flatMap((t: any) => t.assignments).find((a: any) => a.id === field.id)).toMatchObject({ assignedRole: 'PIVOT', manuallyChanged: true });
  expect((await request.put(`/api/matches/${g.match.id}/teams/assignments/${field.id}`, { headers: auth(g.owner), data: { teamNumber: 99, assignedRole: 'PIVOT' } })).status()).toBe(400);
  expect((await request.put(`/api/matches/${g.match.id}/teams/assignments/${field.id}`, { headers: auth(g.owner), data: { teamNumber: 1, assignedRole: 'INVALID_ROLE' } })).status()).toBe(400);
  await going(request, g.match.id, g.members[2], 'NOT_GOING');
  expect((await body(await request.get(`/api/matches/${g.match.id}/teams`, { headers: auth(g.owner) }))).teams.flatMap((t: any) => t.assignments)).toHaveLength(0);
});

test('team generation rejects missing keepers and incomplete/minimum participation', async ({ request, control }) => {
  const g = await group(request, 1);
  const match = await createMatch(request, control, g.id, g.owner, { minimumPlayers: 4 });
  await profile(request, g.id, g.owner);
  await profile(request, g.id, g.members[0]);
  await going(request, match.id, g.owner);
  await going(request, match.id, g.members[0]);
  expect((await request.post(`/api/matches/${match.id}/teams/generate`, { headers: auth(g.owner) })).status()).toBe(409);
  await body(await request.put(`/api/matches/${match.id}/player-configuration`, { headers: auth(g.owner), data: { modality: 'FUTSAL', minimumPlayers: 2 } }));
  const noKeepers = await request.post(`/api/matches/${match.id}/teams/generate`, { headers: auth(g.owner) });
  expect(noKeepers.status()).toBe(409);
  expect((await noKeepers.json()).code).toContain('GOALKEEPER');
});

test('automatic and manual reserves persist, reject foreign assignments and respect permission', async ({ request, control }) => {
  const g = await group(request, 1);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 12 });
  for (const [index, actor] of g.actors.entries()) { await profile(request, g.id, actor, 'GOALKEEPER'); await going(request, match.id, actor); }
  for (let i = 0; i < 10; i++) await body(await request.post(`/api/matches/${match.id}/guests`, { headers: auth(g.owner), data: { displayName: `Convidado ${i}`, primaryPosition: i % 2 ? 'MIDFIELDER' : 'ATTACKER' } }));
  const teams = await body(await request.post(`/api/matches/${match.id}/teams/generate`, { headers: auth(g.owner) }));
  expect(teams.teams.flatMap((t: any) => t.assignments)).toHaveLength(12);
  const path = `/api/matches/${match.id}/teams/reserves`;
  const auto = await body(await request.post(path + '/auto', { headers: auth(g.owner) }));
  expect(auto.reserveAssignmentIds).toHaveLength(2);
  const listed = await body(await request.get(path, { headers: auth(g.members[0]) }));
  expect(listed.reserveAssignmentIds).toEqual(auto.reserveAssignmentIds);
  expect((await request.put(path, { headers: auth(g.members[0]), data: { reserveAssignmentIds: [] } })).status()).toBe(403);
  expect((await request.put(path, { headers: auth(g.owner), data: { reserveAssignmentIds: ['00000000-0000-4000-8000-000000000001'] } })).status()).toBe(400);
  const manual = await body(await request.put(path, { headers: auth(g.owner), data: { reserveAssignmentIds: [auto.reserveAssignmentIds[0]] } }));
  expect(manual.reserveAssignmentIds).toEqual([auto.reserveAssignmentIds[0]]);
});

test('team names/images persist for the group and are snapshotted on live start', async ({ request, control }) => {
  const g = await generatedMatch(request, control);
  const images = `/api/matches/${g.match.id}/teams/images`;
  expect(await body(await request.get(images, { headers: auth(g.members[0]) }))).toHaveLength(2);
  const upload = await body(await request.post(`/api/matches/${g.match.id}/teams/1/image`, { headers: auth(g.owner), multipart: { image: { name: 'team.png', mimeType: 'image/png', buffer: png } } }));
  expect(JSON.stringify(upload)).toContain('https://media.onze.test/teams/');
  await body(await request.put(`/api/matches/${g.match.id}/live/start`, { headers: auth(g.owner), data: { teams: [{ teamNumber: 1, name: 'Preto QA' }, { teamNumber: 2, name: 'Branco QA' }] } }));
  const live = await body(await request.get(`/api/matches/${g.match.id}/live`, { headers: auth(g.members[0]) }));
  expect(live.scores[0]).toMatchObject({ name: 'Preto QA', imageUrl: expect.stringContaining('/teams/') });
  const next = await createMatch(request, control, g.id, g.owner);
  const reused = await body(await request.get(`/api/matches/${next.id}/teams/images`, { headers: auth(g.owner) }));
  expect(reused[0]).toMatchObject({ name: 'Preto QA', imageUrl: live.scores[0].imageUrl });
});

test('three internal teams reserve and distribute three goalkeepers without duplicating participants', async ({ request, control }) => {
  const g = await group(request, 5);
  for (const [index, actor] of g.actors.entries()) await profile(request, g.id, actor, index < 3 ? 'GOALKEEPER' : 'MIDFIELDER');
  const match = await createMatch(request, control, g.id, g.owner, { teamCount: 3, requiredGoalkeepers: 3, maxPlayers: 8 });
  for (const actor of g.actors) await going(request, match.id, actor);
  const teams = await body(await request.post(`/api/matches/${match.id}/teams/generate`, { headers: auth(g.owner) }));
  expect(teams.teams).toHaveLength(3);
  expect(teams.teams.every((t: any) => t.assignments.filter((p: any) => p.assignedRole === 'GOALKEEPER').length === 1)).toBe(true);
  expect(new Set(teams.teams.flatMap((t: any) => t.assignments.map((p: any) => p.participantId))).size).toBe(6);
});
