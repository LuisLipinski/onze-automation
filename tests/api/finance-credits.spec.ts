import { test, expect } from '../support/test';
import { preparedMatch, createMatch, auth, body, going, getMatch, promote, profile, dateTime } from '../support/factory';

test('payment requires player report, supports rejection/re-report and confirms idempotently', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const player = g.members[1];
  const path = `/api/matches/${g.match.id}/payments/${player.user.id}`;
  expect((await request.put(path + '/confirm', { headers: auth(g.owner) })).status()).toBe(409);
  await body(await request.post(path + '/reminder', { headers: auth(g.owner) }));
  await body(await request.post(path + '/reminder', { headers: auth(g.owner) }));
  expect((await getMatch(request, g.match.id, player)).myPaymentStatus).toBe('PENDING');
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(player) }));
  expect((await request.post(path + '/reminder', { headers: auth(g.owner) })).status()).toBe(409);
  expect((await request.put(path + '/confirm', { headers: auth(g.members[2]) })).status()).toBe(403);
  await body(await request.put(path + '/reject', { headers: auth(g.owner) }));
  expect((await getMatch(request, g.match.id, player))).toMatchObject({ myPaymentStatus: 'PENDING', myAttendance: 'GOING', myRemainingPaymentAmount: 25 });
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(player) }));
  await body(await request.put(path + '/confirm', { headers: auth(g.owner) }));
  await body(await request.put(path + '/confirm', { headers: auth(g.owner) }));
  expect((await getMatch(request, g.match.id, player)).myPaymentStatus).toBe('PAID');
  expect((await request.put(path + '/reject', { headers: auth(g.owner) })).status()).toBe(409);
});

test('payment privacy is independent of player management permission', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const [admin, player] = g.members;
  await promote(request, g.id, g.owner, admin, ['MANAGE_MATCH_PLAYERS']);
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(player) }));
  let state = await getMatch(request, g.match.id, admin);
  expect(state.attendances.find((a: any) => a.userId === player.user.id).paymentStatus).toBeNull();
  expect(state).toMatchObject({ canManagePlayers: true, canManagePayments: false });
  await body(await request.put(`/api/groups/${g.id}/members/${admin.membershipId}/permissions`, { headers: auth(g.owner), data: { permissions: ['MANAGE_PAYMENTS'] } }));
  state = await getMatch(request, g.match.id, admin);
  expect(state.attendances.find((a: any) => a.userId === player.user.id).paymentStatus).toBe('REPORTED');
  const credits = await body(await request.get(`/api/groups/${g.id}/credits`, { headers: auth(player) }));
  expect(credits.every((c: any) => c.userId === player.user.id)).toBe(true);
});

test('deadline removes only unpaid players, retains reported/paid and allows late replacement payment', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const [reported, paid, pending] = g.members;
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(reported) }));
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(paid) }));
  await body(await request.put(`/api/matches/${g.match.id}/payments/${paid.user.id}/confirm`, { headers: auth(g.owner) }));
  await control.at(new Date(Date.parse(g.match.paymentDeadline) + 1000).toISOString());
  await control.process();
  expect((await getMatch(request, g.match.id, pending))).toMatchObject({ myAttendance: 'NOT_GOING', myPaymentStatus: 'CANCELLED' });
  expect((await getMatch(request, g.match.id, reported))).toMatchObject({ myAttendance: 'GOING', myPaymentStatus: 'REPORTED' });
  expect((await getMatch(request, g.match.id, paid))).toMatchObject({ myAttendance: 'GOING', myPaymentStatus: 'PAID' });
  await going(request, g.match.id, reported, 'NOT_GOING');
  await body(await request.put(`/api/matches/${g.match.id}/replacements/${reported.user.id}`, { headers: auth(g.owner), data: { replacementUserId: pending.user.id } }));
  const restored = await getMatch(request, g.match.id, pending);
  expect(restored).toMatchObject({ myAttendance: 'GOING', canReportPayment: true });
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(pending) }));
  await control.process();
  expect((await getMatch(request, g.match.id, pending)).myPaymentStatus).toBe('REPORTED');
});

test('goalkeeper exemption prevents charge/removal and cannot erase already-reported cash', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true });
  expect((await getMatch(request, g.match.id, g.owner))).toMatchObject({ myPaymentStatus: null, canReportPayment: false });
  expect((await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(g.owner) })).status()).toBe(409);
  const field = g.members[1];
  await profile(request, g.id, field, 'MIDFIELDER', null, true);
  await body(await request.put(`/api/matches/${g.match.id}/goalkeepers/${field.user.id}`, { headers: auth(g.owner), data: { isGoalkeeper: true } }));
  expect((await getMatch(request, g.match.id, field)).myPaymentStatus).toBeNull();
  await body(await request.put(`/api/matches/${g.match.id}/goalkeepers/${field.user.id}`, { headers: auth(g.owner), data: { isGoalkeeper: false } }));
  expect((await getMatch(request, g.match.id, field)).myPaymentStatus).toBe('PENDING');
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(field) }));
  expect((await request.put(`/api/matches/${g.match.id}/goalkeepers/${field.user.id}`, { headers: auth(g.owner), data: { isGoalkeeper: true } })).status()).toBe(409);
  await control.at(new Date(Date.parse(g.match.paymentDeadline) + 1000).toISOString());
  await control.process();
  expect((await getMatch(request, g.match.id, g.owner)).myAttendance).toBe('GOING');
});

test('paid withdrawal locks settlement until replacement, credit reserves nearest match once', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const player = g.members[1];
  const settlement = `/api/matches/${g.match.id}/payments/${player.user.id}/settlement`;
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(player) }));
  await body(await request.put(`/api/matches/${g.match.id}/payments/${player.user.id}/confirm`, { headers: auth(g.owner) }));
  await going(request, g.match.id, player, 'NOT_GOING');
  expect((await request.put(settlement, { headers: auth(g.owner), data: { resolution: 'CREDITED' } })).status()).toBe(409);
  expect((await request.put(`/api/matches/${g.match.id}/attendance`, { headers: auth(player), data: { status: 'GOING' } })).status()).toBe(409);
  await body(await request.put(`/api/matches/${g.match.id}/replacements/${player.user.id}`, { headers: auth(g.owner), data: { replacementUserId: player.user.id } }));
  // Reinstatement restores the player; a later cancellation resolves the resulting cash obligation.
  await body(await request.delete(`/api/matches/${g.match.id}`, { headers: auth(g.owner) }), 204);
  await body(await request.put(settlement, { headers: auth(g.owner), data: { resolution: 'CREDITED' } }));
  let credits = await body(await request.get(`/api/groups/${g.id}/credits`, { headers: auth(player) }));
  expect(credits[0].availableAmount).toBe(25);
  const next = await createMatch(request, control, g.id, g.owner, { paymentRequired: true, paymentAmount: 15 });
  let pending = await getMatch(request, next.id, player);
  expect(pending).toMatchObject({ myCreditAppliedAmount: 15, myCreditAllocationStatus: 'RESERVED' });
  await going(request, next.id, player);
  await going(request, next.id, player);
  pending = await getMatch(request, next.id, player);
  expect(pending).toMatchObject({ myPaymentStatus: 'PAID', myCreditAppliedAmount: 15 });
  credits = await body(await request.get(`/api/groups/${g.id}/credits`, { headers: auth(player) }));
  expect(credits[0].availableAmount).toBe(10);
});

test('bulk cancellation settlements support not received, refunds, retained funds and reject paid not-received', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  for (const actor of g.actors) await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(actor) }));
  await body(await request.put(`/api/matches/${g.match.id}/payments/${g.owner.user.id}/confirm`, { headers: auth(g.owner) }));
  await body(await request.delete(`/api/matches/${g.match.id}`, { headers: auth(g.owner) }), 204);
  const path = `/api/matches/${g.match.id}/payment-settlements`;
  expect((await request.put(path, { headers: auth(g.owner), data: { playerUserIds: [g.owner.user.id], resolution: 'NOT_RECEIVED' } })).status()).toBe(409);
  await body(await request.put(path, { headers: auth(g.owner), data: { playerUserIds: [g.members[0].user.id], resolution: 'NOT_RECEIVED' } }));
  await body(await request.put(path, { headers: auth(g.owner), data: { playerUserIds: [g.owner.user.id, g.members[1].user.id], resolution: 'REFUNDED' } }));
  await body(await request.put(`/api/matches/${g.match.id}/payments/${g.members[2].user.id}/settlement`, { headers: auth(g.owner), data: { resolution: 'RETAINED' } }));
  const state = await getMatch(request, g.match.id, g.owner);
  expect(state.attendances.find((a: any) => a.userId === g.owner.user.id).paymentSettlementStatus).toBe('REFUNDED');
  expect(state.attendances.find((a: any) => a.userId === g.members[0].user.id).paymentSettlementStatus).toBe('NOT_RECEIVED');
  expect(state.attendances.find((a: any) => a.userId === g.members[2].user.id).paymentSettlementStatus).toBe('RETAINED');
});

test('credit follows chronological priority, leaves the waiting list uncharged and returns on promotion', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const player = g.members[1];
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(player) }));
  await body(await request.put(`/api/matches/${g.match.id}/payments/${player.user.id}/confirm`, { headers: auth(g.owner) }));
  await body(await request.delete(`/api/matches/${g.match.id}`, { headers: auth(g.owner) }), 204);
  await body(await request.put(`/api/matches/${g.match.id}/payments/${player.user.id}/settlement`, { headers: auth(g.owner), data: { resolution: 'CREDITED' } }));
  const now = Date.parse(await control.now());
  const farDate = dateTime(new Date(now + 5 * 86400000).toISOString());
  const nearDate = dateTime(new Date(now + 4 * 86400000).toISOString());
  const far = await createMatch(request, control, g.id, g.owner, { date: farDate.date, startTime: farDate.time, paymentRequired: true });
  const near = await createMatch(request, control, g.id, g.owner, { date: nearDate.date, startTime: nearDate.time, paymentRequired: true, maxPlayers: 3 });
  expect((await getMatch(request, near.id, player)).myCreditAppliedAmount).toBe(25);
  expect((await getMatch(request, far.id, player)).myCreditAppliedAmount).toBe(0);
  for (const actor of [g.owner, g.members[0], g.members[2]]) await going(request, near.id, actor);
  const waiting = await going(request, near.id, player);
  expect(waiting).toMatchObject({ myAttendance: 'WAITLISTED', myCreditAppliedAmount: 0, myPaymentStatus: null });
  const credits = await body(await request.get(`/api/groups/${g.id}/credits`, { headers: auth(player) }));
  expect(credits[0]).toMatchObject({ allocatedMatchId: far.id, allocatedAmount: 25 });
  await going(request, near.id, g.members[2], 'NOT_GOING');
  const promoted = await getMatch(request, near.id, player);
  expect(promoted).toMatchObject({ myAttendance: 'GOING', myPaymentStatus: 'PAID', myCreditAppliedAmount: 25, myRemainingPaymentAmount: 0 });
  expect((await getMatch(request, far.id, player)).myCreditAppliedAmount).toBe(0);
  expect((await body(await request.get(`/api/groups/${g.id}/credits`, { headers: auth(player) })))[0].availableAmount).toBe(0);
});

test('credit reserved for unconfirmed attendance is released at signup expiration', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const player = g.members[1];
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(player) }));
  await body(await request.put(`/api/matches/${g.match.id}/payments/${player.user.id}/confirm`, { headers: auth(g.owner) }));
  await body(await request.delete(`/api/matches/${g.match.id}`, { headers: auth(g.owner) }), 204);
  await body(await request.put(`/api/matches/${g.match.id}/payments/${player.user.id}/settlement`, { headers: auth(g.owner), data: { resolution: 'CREDITED' } }));
  const next = await createMatch(request, control, g.id, g.owner, { paymentRequired: true });
  expect((await getMatch(request, next.id, player))).toMatchObject({ myAttendance: 'PENDING', myCreditAppliedAmount: 25, myCreditAllocationStatus: 'RESERVED', goingCount: 0 });
  await control.at(new Date(Date.parse(next.signupDeadline) + 1000).toISOString());
  await control.process();
  expect((await getMatch(request, next.id, player)).myCreditAppliedAmount).toBe(0);
  const credits = await body(await request.get(`/api/groups/${g.id}/credits`, { headers: auth(player) }));
  expect(credits[0]).toMatchObject({ availableAmount: 25, allocatedAmount: 0 });
});
