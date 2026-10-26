import { test, expect } from '../support/test';
import { group, register, auth, body, profile, createMatch, matchData, going, getMatch, dateTime } from '../support/factory';

test('one-off match supports all modalities and persists timing/payment configuration', async ({ request, control }) => {
  const g = await group(request, 0);
  for (const modality of ['FUTSAL', 'FUT7', 'FIELD']) {
    const match = await createMatch(request, control, g.id, g.owner, { modality, periodsEnabled: true, periodCount: 4, periodDurationMinutes: 15, overtimeEnabled: true, overtimePeriodCount: 2, overtimePeriodDurationMinutes: 5, penaltyShootoutEnabled: true, paymentRequired: true, goalkeeperPays: true });
    expect(match).toMatchObject({ modality, periodsEnabled: true, periodCount: 4, periodDurationMinutes: 15, overtimeEnabled: true, overtimePeriodCount: 2, overtimePeriodDurationMinutes: 5, penaltyShootoutEnabled: true, paymentAmount: 25, pixKey: 'qa@onze.test', goalkeeperPays: true });
  }
  const listed = await body(await request.get(`/api/groups/${g.id}/matches`, { headers: auth(g.owner) }));
  expect(listed).toHaveLength(3);
});

for (const [name, overrides] of Object.entries({
  'capacity below two': { maxPlayers: 1 },
  'minimum above maximum': { minimumPlayers: 9, maxPlayers: 8 },
  'invalid timezone': { timeZone: 'Unknown/Timezone' },
  'zero periods': { periodsEnabled: true, periodCount: 0, periodDurationMinutes: 10 },
  'more than four periods': { periodsEnabled: true, periodCount: 5, periodDurationMinutes: 10 },
  'zero duration': { periodsEnabled: true, periodCount: 2, periodDurationMinutes: 0 },
  'invalid internal keepers': { teamCount: 3, requiredGoalkeepers: 2 },
  'invalid external keeper count': { matchType: 'VERSUS_EXTERNAL', teamCount: null, requiredGoalkeepers: 0 },
  'missing signup half': { signupDeadlineTime: null },
  'zero payment': { paymentRequired: true, paymentAmount: 0 },
})) test(`match creation rejects ${name}`, async ({ request, control }) => {
  const g = await group(request, 0);
  const response = await request.post(`/api/groups/${g.id}/matches`, { headers: auth(g.owner), data: await matchData(control, overrides) });
  expect(response.status()).toBe(400);
  expect(await body(await request.get(`/api/groups/${g.id}/matches`, { headers: auth(g.owner) }))).toEqual([]);
});

test('weekly series keeps four independent occurrences, rolls its window and cancels independently', async ({ request, control }) => {
  const g = await group(request, 1);
  await profile(request, g.id, g.owner, 'GOALKEEPER');
  const first = await createMatch(request, control, g.id, g.owner, { recurrence: 'WEEKLY', goalkeeperPays: true });
  let matches = await body(await request.get(`/api/groups/${g.id}/matches`, { headers: auth(g.owner) }));
  expect(matches).toHaveLength(4);
  expect(new Set(matches.map((m: any) => m.id)).size).toBe(4);
  expect(matches.every((m: any) => m.seriesId === first.seriesId)).toBe(true);
  expect(matches[0].attendanceOpen).toBe(true);
  expect(matches.slice(1).every((m: any) => !m.attendanceOpen)).toBe(true);
  await going(request, first.id, g.owner);
  expect((await getMatch(request, matches[1].id, g.owner)).myAttendance).not.toBe('GOING');
  await body(await request.put(`/api/matches/${first.id}/player-configuration`, { headers: auth(g.owner), data: { modality: 'FUT7', minimumPlayers: 3, maxPlayers: 18 } }));
  matches = await body(await request.get(`/api/groups/${g.id}/matches`, { headers: auth(g.owner) }));
  expect(matches.every((m: any) => m.maxPlayers === 18 && m.modality === 'FUT7')).toBe(true);
  await body(await request.delete(`/api/matches/${first.id}`, { headers: auth(g.owner) }), 204);
  expect((await getMatch(request, matches[1].id, g.owner)).status).toBe('SCHEDULED');
  await control.at(new Date(Date.parse(first.startsAt) + 3600000).toISOString());
  await control.process();
  const next = await getMatch(request, matches[1].id, g.owner);
  expect(next.attendanceOpen).toBe(true);
  const upcoming = await body(await request.get('/api/matches/upcoming', { headers: auth(g.owner) }));
  expect(upcoming.filter((m: any) => m.seriesId === first.seriesId)).toHaveLength(4);
  await body(await request.delete(`/api/match-series/${first.seriesId}`, { headers: auth(g.owner) }), 204);
  const cancelled = await getMatch(request, matches[1].id, g.owner);
  expect(cancelled).toMatchObject({ status: 'CANCELLED', seriesActive: false });
  expect((await getMatch(request, first.id, g.owner)).status).toBe('CANCELLED');
});

test('signup closes, unconfirmed players stay out and admin may approve below minimum', async ({ request, control }) => {
  const g = await group(request, 1);
  const match = await createMatch(request, control, g.id, g.owner, { minimumPlayers: 4 });
  const path = `/api/matches/${match.id}/minimum-player-decision`;
  expect((await body(await request.get(path, { headers: auth(g.members[0]) }))).decisionRequired).toBe(false);
  expect((await request.put(path + '/approve', { headers: auth(g.owner) })).status()).toBe(409);
  await control.at(new Date(Date.parse(match.signupDeadline) + 1000).toISOString());
  await control.process();
  const closed = await getMatch(request, match.id, g.owner);
  expect(closed).toMatchObject({ signupOpen: false, goingCount: 0 });
  expect((await request.put(`/api/matches/${match.id}/attendance`, { headers: auth(g.members[0]), data: { status: 'GOING' } })).status()).toBe(409);
  expect((await body(await request.get(path, { headers: auth(g.owner) }))).decisionRequired).toBe(true);
  expect((await request.put(path + '/approve', { headers: auth(g.members[0]) })).status()).toBe(403);
  expect(await body(await request.put(path + '/approve', { headers: auth(g.owner) }))).toMatchObject({ belowMinimumApproved: true, decisionRequired: false });
});

test('admin extends signup and reviews payment deadline before reopening enrollment', async ({ request, control }) => {
  const g = await group(request, 1);
  const match = await createMatch(request, control, g.id, g.owner, { paymentRequired: true, minimumPlayers: 4 });
  await control.at(new Date(Date.parse(match.signupDeadline) + 1000).toISOString());
  const newSignup = dateTime(new Date(Date.parse(match.paymentDeadline) + 3600000).toISOString());
  const newPayment = dateTime(new Date(Date.parse(match.startsAt) - 3600000).toISOString());
  const path = `/api/matches/${match.id}/minimum-player-decision/extend`;
  const data = { signupDeadlineDate: newSignup.date, signupDeadlineTime: newSignup.time };
  expect((await request.put(path, { headers: auth(g.owner), data })).status()).toBe(409);
  const extended = await body(await request.put(path, { headers: auth(g.owner), data: { ...data, paymentDeadlineDate: newPayment.date, paymentDeadlineTime: newPayment.time } }));
  expect(extended.decisionRequired).toBe(false);
  const joined = await going(request, match.id, g.members[0]);
  expect(joined.myAttendance).toBe('GOING');
});

test('every member shares a match while public landing page reveals no private data', async ({ request, control }) => {
  const g = await group(request, 1);
  const match = await createMatch(request, control, g.id, g.owner, { paymentRequired: true, notes: 'PRIVATE-NOTE', venue: 'PRIVATE-VENUE' });
  const shared = await body(await request.get(`/api/matches/${match.id}/share`, { headers: auth(g.members[0]) }));
  expect(JSON.stringify(shared)).toContain(match.id);
  const page = await request.get(`/m/${match.id}`);
  expect(page.status()).toBe(200);
  expect(page.headers()['content-type']).toContain('text/html');
  const html = await page.text();
  expect(html).toContain('onze://match?matchId=');
  expect(html).not.toContain('PRIVATE-NOTE');
  expect(html).not.toContain('PRIVATE-VENUE');
  expect(html).not.toContain('qa@onze.test');
  const outsider = await register(request);
  expect((await request.get(`/api/matches/${match.id}/share`, { headers: auth(outsider) })).status()).toBe(403);
  expect((await request.get('/m/00000000-0000-4000-8000-000000000001')).status()).toBe(404);
});
