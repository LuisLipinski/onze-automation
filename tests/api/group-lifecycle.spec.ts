import { test, expect } from '../support/test';
import { group, register, profile, promote, createMatch, auth, body, png, ratings } from '../support/factory';

test('group deletion is principal-only, cascades owned data and keeps notices isolated/idempotent', async ({ request, control }) => {
  const g = await group(request, 2);
  const [admin, member] = g.members;
  await promote(request, g.id, g.owner, admin, ['EDIT_GROUP', 'REMOVE_MEMBERS']);
  const match = await createMatch(request, control, g.id, g.owner);
  const other = await body(await request.post('/api/groups', { headers: auth(member), data: { name: 'Outro grupo preservado' } }), 201);
  expect((await request.delete(`/api/groups/${g.id}`, { headers: auth(admin) })).status()).toBe(403);
  expect((await request.delete(`/api/groups/${g.id}`, { headers: auth(member) })).status()).toBe(403);
  await body(await request.delete(`/api/groups/${g.id}`, { headers: auth(g.owner) }), 204);
  expect((await request.get(`/api/matches/${match.id}`, { headers: auth(g.owner) })).status()).toBe(404);
  expect((await request.get(`/join/${g.invitation.code}`, { headers: { Accept: 'text/html' } })).status()).toBe(404);
  const notices = await body(await request.get('/api/groups/deletion-notices', { headers: auth(member) }));
  expect(notices).toHaveLength(1);
  expect(notices[0]).toMatchObject({ groupId: g.id, groupName: 'Grupo automação' });
  const outsider = await register(request);
  expect(await body(await request.get('/api/groups/deletion-notices', { headers: auth(outsider) }))).toEqual([]);
  expect((await request.post(`/api/groups/deletion-notices/${notices[0].id}/acknowledge`, { headers: auth(outsider) })).status()).toBe(404);
  await body(await request.post(`/api/groups/deletion-notices/${notices[0].id}/acknowledge`, { headers: auth(member) }), 204);
  await body(await request.post(`/api/groups/deletion-notices/${notices[0].id}/acknowledge`, { headers: auth(member) }), 204);
  expect(await body(await request.get('/api/groups/deletion-notices', { headers: auth(member) }))).toEqual([]);
  expect((await request.delete(`/api/groups/${g.id}`, { headers: auth(g.owner) })).status()).toBe(404);
  const groups = await body(await request.get('/api/groups', { headers: auth(member) }));
  expect(groups.map((item: any) => item.id)).toEqual([other.id]);
});

test('photo validation and provider failure preserve the saved group', async ({ request, control }) => {
  const g = await group(request, 0);
  const path = `/api/groups/${g.id}/photo`;
  const invalid = await request.post(path, { headers: auth(g.owner), multipart: { photo: { name: 'text.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') } } });
  expect(invalid.status()).toBe(400);
  const large = await request.post(path, { headers: auth(g.owner), multipart: { photo: { name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) } } });
  expect([400, 413]).toContain(large.status());
  const saved = await body(await request.post(path, { headers: auth(g.owner), multipart: { photo: { name: 'photo.png', mimeType: 'image/png', buffer: png } } }));
  expect(saved.photoUrl).toBe(`https://media.onze.test/groups/${g.id}.png`);
  await control.call('/boundaries', { failMedia: true });
  expect((await request.post(path, { headers: auth(g.owner), multipart: { photo: { name: 'photo.png', mimeType: 'image/png', buffer: png } } })).status()).toBe(502);
  const [current] = await body(await request.get('/api/groups', { headers: auth(g.owner) }));
  expect(current.photoUrl).toBe(saved.photoUrl);
});

test('ordinary members read their own technical profile without editing it or reading another member', async ({ request }) => {
  const g = await group(request, 2);
  const [member, other] = g.members;
  const ownPath = `/api/groups/${g.id}/members/me/technical-profile`;
  const before = await body(await request.get(ownPath, { headers: auth(member) }));
  expect(Object.values(before.ratings).every(v => v === null)).toBe(true);
  const adminPath = `/api/groups/${g.id}/members/${member.membershipId}/technical-profile`;
  await body(await request.put(adminPath, { headers: auth(g.owner), data: { ratings: ratings(8) } }));
  const own = await body(await request.get(ownPath, { headers: auth(member) }));
  expect(own.ratings).toEqual(ratings(8));
  expect((await request.get(`/api/groups/${g.id}/members/${other.membershipId}/technical-profile`, { headers: auth(member) })).status()).toBe(403);
  expect((await request.put(adminPath, { headers: auth(member), data: { ratings: ratings(1) } })).status()).toBe(403);
  expect((await request.put(ownPath, { headers: auth(member), data: { ratings: ratings(1) } })).status()).toBe(400);
  const outsider = await register(request);
  expect((await request.get(ownPath, { headers: auth(outsider) })).status()).toBe(403);
  expect((await body(await request.get(ownPath, { headers: auth(member) }))).ratings).toEqual(ratings(8));
});

test('technical configuration and all 17 ratings enforce ranges, clearing and group isolation', async ({ request }) => {
  const g = await group(request, 1);
  const config = await body(await request.get('/api/technical/configuration', { headers: auth(g.owner) }));
  expect(JSON.stringify(config)).toContain('GOALKEEPER_REFLEXES');
  const path = `/api/groups/${g.id}/members/${g.members[0].membershipId}/technical-profile`;
  for (const score of [0, 11, -1]) expect((await request.put(path, { headers: auth(g.owner), data: { ratings: { PASSING: score } } })).status()).toBe(400);
  await body(await request.put(path, { headers: auth(g.owner), data: { ratings: ratings(10) } }));
  const actual = await body(await request.get(path, { headers: auth(g.owner) }));
  expect(actual.ratings).toEqual(ratings(10));
  await body(await request.put(path, { headers: auth(g.owner), data: { ratings: { PASSING: null } } }));
  expect((await body(await request.get(path, { headers: auth(g.owner) }))).ratings).not.toHaveProperty('PASSING');
  const other = await group(request, 0);
  expect((await request.get(`/api/groups/${other.id}/members/${g.members[0].membershipId}/technical-profile`, { headers: auth(other.owner) })).status()).toBe(404);
});

test('membership positions normalize goalkeeper volunteering and reject conflicting or absent positions', async ({ request }) => {
  const g = await group(request, 1);
  const member = g.members[0];
  const actual = await profile(request, g.id, member, 'GOALKEEPER', 'DEFENDER', true);
  expect(actual).toMatchObject({ primaryPosition: 'GOALKEEPER', secondaryPosition: 'DEFENDER', canPlayGoalkeeper: false, complete: true });
  const administrative = await body(await request.get(`/api/groups/${g.id}/members/${member.membershipId}/sports-profile`, { headers: auth(g.owner) }));
  expect(administrative).toEqual(actual);
  const path = `/api/groups/${g.id}/members/me/sports-profile`;
  for (const positions of [[], ['MIDFIELDER','MIDFIELDER'], ['MIDFIELDER','DEFENDER','ATTACKER']]) {
    expect((await request.put(path, { headers: auth(member), data: { positions, canPlayGoalkeeper: false, dominantFoot: 'RIGHT' } })).status()).toBe(400);
  }
  expect((await body(await request.get(path, { headers: auth(member) }))).primaryPosition).toBe('GOALKEEPER');
});

test('delegated operations stop immediately on revocation and principal powers cannot be delegated', async ({ request }) => {
  const g = await group(request, 2);
  const [admin, member] = g.members;
  await promote(request, g.id, g.owner, admin, ['EDIT_GROUP', 'EDIT_PLAYER_PROFILES', 'REMOVE_MEMBERS']);
  await body(await request.put(`/api/groups/${g.id}/details`, { headers: auth(admin), data: { city: 'Curitiba', schedules: [] } }));
  await body(await request.put(`/api/groups/${g.id}/members/${admin.membershipId}/permissions`, { headers: auth(g.owner), data: { permissions: [] } }));
  expect((await request.put(`/api/groups/${g.id}/details`, { headers: auth(admin), data: { city: 'Outra cidade', schedules: [] } })).status()).toBe(403);
  expect((await request.put(`/api/groups/${g.id}/members/${member.membershipId}/permissions`, { headers: auth(admin), data: { permissions: ['EDIT_GROUP'] } })).status()).toBe(403);
  expect((await request.put(`/api/groups/${g.id}/primary-admin`, { headers: auth(admin), data: { replacementMemberId: admin.membershipId } })).status()).toBe(403);
  await body(await request.put(`/api/groups/${g.id}/members/${admin.membershipId}/demote`, { headers: auth(g.owner) }));
  const list = await body(await request.get(`/api/groups/${g.id}/members`, { headers: auth(g.owner) }));
  expect(list.find((m: any) => m.userId === admin.user.id)).toMatchObject({ role: 'MEMBER', permissions: [] });
  await body(await request.delete(`/api/groups/${g.id}/members/${member.membershipId}`, { headers: auth(g.owner) }), 204);
  expect((await request.get(`/api/groups/${g.id}/members`, { headers: auth(member) })).status()).toBe(403);
});
