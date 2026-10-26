import { test, expect } from '../support/test';
import { group, profile, createMatch, auth, body, going, getMatch } from '../support/factory';

test('14 places reserve two keepers, FIFO is stable and leaving/rejoining changes priority', async ({ request, control }) => {
  const g = await group(request, 14);
  for (let i = 0; i < g.actors.length; i++) await profile(request, g.id, g.actors[i], i === 14 ? 'GOALKEEPER' : 'MIDFIELDER');
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 14, paymentRequired: true });
  for (const actor of g.actors.slice(0,12)) await going(request, match.id, actor);
  const first = await going(request, match.id, g.actors[12]);
  expect(first).toMatchObject({ myAttendance: 'WAITLISTED', myWaitlistPosition: 1, goingCount: 12, reservedGoalkeeperSlots: 2, myPaymentStatus: null });
  const repeated = await going(request, match.id, g.actors[12]);
  expect(repeated.myWaitlistPosition).toBe(1);
  expect((await going(request, match.id, g.actors[13])).myWaitlistPosition).toBe(2);
  expect((await going(request, match.id, g.actors[14])).myAttendance).toBe('GOING');
  await going(request, match.id, g.owner, 'NOT_GOING');
  expect((await getMatch(request, match.id, g.actors[12])).myAttendance).toBe('GOING');
  expect((await going(request, match.id, g.owner)).myWaitlistPosition).toBe(2);
  await going(request, match.id, g.actors[1], 'NOT_GOING');
  const promoted = await getMatch(request, match.id, g.actors[13]);
  expect(promoted.myAttendance).toBe('GOING');
  expect(promoted.myPaymentStatus).toBe('PENDING');
  expect((await getMatch(request, match.id, g.owner)).myWaitlistPosition).toBe(1);
});

test('keeper vacancy promotes compatible keeper and preserves earlier outfield waiter', async ({ request, control }) => {
  const g = await group(request, 5);
  for (let i = 0; i < g.actors.length; i++) await profile(request, g.id, g.actors[i], [0,1,5].includes(i) ? 'GOALKEEPER' : 'MIDFIELDER');
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 4 });
  for (const actor of g.actors.slice(0,4)) await going(request, match.id, actor);
  await going(request, match.id, g.actors[4]);
  await going(request, match.id, g.actors[5]);
  await going(request, match.id, g.actors[1], 'NOT_GOING');
  expect((await getMatch(request, match.id, g.actors[5])).myAttendance).toBe('GOING');
  expect((await getMatch(request, match.id, g.actors[4]))).toMatchObject({ myAttendance: 'WAITLISTED', myWaitlistPosition: 1, currentGoalkeepers: 2, goingCount: 4 });
});

test('after deadline admin approves first reserve in goal without changing profile', async ({ request, control }) => {
  const g = await group(request, 2);
  for (const actor of g.actors) await profile(request, g.id, actor);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 3, paymentRequired: true });
  await going(request, match.id, g.owner);
  await going(request, match.id, g.members[0]);
  await going(request, match.id, g.members[1]);
  const path = `/api/matches/${match.id}/waitlist/goalkeeper`;
  const data = { expectedFirstUserId: g.members[0].user.id };
  expect((await request.post(path, { headers: auth(g.owner), data })).status()).toBe(409);
  await control.at(new Date(Date.parse(match.signupDeadline) + 1000).toISOString());
  await control.process();
  expect((await request.post(path, { headers: auth(g.members[1]), data })).status()).toBe(403);
  expect((await request.post(path, { headers: auth(g.owner), data: { expectedFirstUserId: g.members[1].user.id } })).status()).toBe(409);
  const admitted = await body(await request.post(path, { headers: auth(g.owner), data }));
  const player = admitted.attendances.find((a: any) => a.userId === g.members[0].user.id);
  expect(player).toMatchObject({ status: 'GOING', isGoalkeeper: true, paymentExempt: true, paymentStatus: null, primaryPosition: 'MIDFIELDER' });
  const own = await body(await request.get(`/api/groups/${g.id}/members/me/sports-profile`, { headers: auth(g.members[0]) }));
  expect(own.primaryPosition).toBe('MIDFIELDER');
  await going(request, match.id, g.members[1], 'NOT_GOING');
  expect((await getMatch(request, match.id, g.members[1])).myWaitlistPosition).toBeNull();
});

test('guest preference requires an explicit first-in-queue decision and keeps capacity', async ({ request, control }) => {
  const g = await group(request, 2);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 4 });
  for (const name of ['Aluguel A','Aluguel B']) await body(await request.post(`/api/matches/${match.id}/rental-goalkeepers`, { headers: auth(g.owner), data: { displayName: name } }));
  await going(request, match.id, g.owner);
  const guestState = await body(await request.post(`/api/matches/${match.id}/guests`, { headers: auth(g.owner), data: { displayName: 'Convidado', primaryPosition: 'MIDFIELDER' } }));
  const guestId = guestState.guests[0].id;
  await going(request, match.id, g.members[0]);
  expect((await getMatch(request, match.id, g.owner)).guestPreferenceDecisionRequired).toBe(true);
  const path = `/api/matches/${match.id}/waitlist/guest-preference`;
  const expectedFirstUserId = g.members[0].user.id;
  expect((await request.post(path, { headers: auth(g.members[0]), data: { expectedFirstUserId, action: 'KEEP_GUESTS' } })).status()).toBe(403);
  const kept = await body(await request.post(path, { headers: auth(g.owner), data: { expectedFirstUserId, action: 'KEEP_GUESTS' } }));
  expect(kept).toMatchObject({ waitlistCount: 1, guestPreferenceDecisionRequired: false });
  expect(kept.guests).toHaveLength(1);
  expect((await request.post(path, { headers: auth(g.owner), data: { expectedFirstUserId, action: 'PROMOTE_MEMBER', guestId } })).status()).toBe(409);
  await going(request, match.id, g.members[0], 'NOT_GOING');
  await going(request, match.id, g.members[1]);
  const replacementId = g.members[1].user.id;
  const replaced = await body(await request.post(path, { headers: auth(g.owner), data: { expectedFirstUserId: replacementId, action: 'PROMOTE_MEMBER', guestId } }));
  expect(replaced.guests).toHaveLength(0);
  expect(replaced.waitlistCount).toBe(0);
  expect((await getMatch(request, match.id, g.members[1])).myAttendance).toBe('GOING');
  expect((await request.post(path, { headers: auth(g.owner), data: { expectedFirstUserId, action: 'PROMOTE_MEMBER', guestId } })).status()).toBe(409);
});

test('rental keeper and invited keeper fill reserved places, field guests cannot', async ({ request, control }) => {
  const g = await group(request, 1);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 3 });
  await going(request, match.id, g.owner);
  const fieldGuest = await request.post(`/api/matches/${match.id}/guests`, { headers: auth(g.owner), data: { displayName: 'Linha', primaryPosition: 'MIDFIELDER' } });
  expect(fieldGuest.status()).toBe(409);
  await body(await request.post(`/api/matches/${match.id}/guests`, { headers: auth(g.owner), data: { displayName: 'Goleiro convidado', primaryPosition: 'GOALKEEPER' } }));
  let state = await body(await request.post(`/api/matches/${match.id}/rental-goalkeepers`, { headers: auth(g.owner), data: { displayName: 'Goleiro alugado' } }));
  expect(state.currentGoalkeepers).toBe(2);
  state = await body(await request.delete(`/api/matches/${match.id}/rental-goalkeepers/${state.rentalGoalkeepers[0].id}`, { headers: auth(g.owner) }));
  expect(state.currentGoalkeepers).toBe(1);
  state = await body(await request.delete(`/api/matches/${match.id}/guests/${state.guests[0].id}`, { headers: auth(g.owner) }));
  expect(state.currentGoalkeepers).toBe(0);
});

test('increasing maximum immediately promotes FIFO and direct WAITLISTED payload is rejected', async ({ request, control }) => {
  const g = await group(request, 2);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 3 });
  await going(request, match.id, g.owner);
  await going(request, match.id, g.members[0]);
  await going(request, match.id, g.members[1]);
  expect((await request.put(`/api/matches/${match.id}/attendance`, { headers: auth(g.members[0]), data: { status: 'WAITLISTED' } })).status()).toBe(400);
  const grown = await body(await request.put(`/api/matches/${match.id}/player-configuration`, { headers: auth(g.owner), data: { modality: 'FUTSAL', minimumPlayers: 2, maxPlayers: 5 } }));
  expect(grown).toMatchObject({ goingCount: 3, waitlistCount: 0, reservedGoalkeeperSlots: 2 });
});

test('concurrent confirmations cannot consume reserved keeper places or duplicate waitlist positions', async ({ request, control }) => {
  const g = await group(request, 3);
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 3 });
  const results = await Promise.all(g.actors.map(actor => going(request, match.id, actor)));
  expect(results.every(r => ['GOING','WAITLISTED'].includes(r.myAttendance))).toBe(true);
  const state = await getMatch(request, match.id, g.owner);
  expect(state).toMatchObject({ goingCount: 1, waitlistCount: 3, reservedGoalkeeperSlots: 2 });
  const positions = state.attendances.filter((a: any) => a.status === 'WAITLISTED').map((a: any) => a.waitlistPosition).sort();
  expect(positions).toEqual([1,2,3]);
});
