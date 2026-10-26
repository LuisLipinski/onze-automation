import { test, expect } from '../support/test';
import { preparedMatch, auth, body, promote, matchData, ratings } from '../support/factory';

const permissions = ['ADD_MEMBERS','REMOVE_MEMBERS','PROMOTE_MEMBERS','EDIT_GROUP','SCHEDULE_GAMES','CANCEL_GAMES','MANAGE_MATCH_PLAYERS','MANAGE_PAYMENTS','MANAGE_TEAMS','MANAGE_LIVE_MATCH','EDIT_PLAYER_PROFILES'];
for (const permission of permissions) test(`${permission}: absent denies, delegated permits and revocation denies immediately`, async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const [admin, target, removable] = g.members;
  await promote(request, g.id, g.owner, admin);
  const schedule = await matchData(control);
  if (permission === 'MANAGE_PAYMENTS') await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(target) }));
  if (permission === 'MANAGE_LIVE_MATCH') await body(await request.post(`/api/matches/${g.match.id}/teams/generate`, { headers: auth(g.owner) }));
  const actions: Record<string, { method: string; path: string; data?: any; success: number }> = {
    ADD_MEMBERS: { method: 'POST', path: `/api/groups/${g.id}/invite`, success: 200 },
    REMOVE_MEMBERS: { method: 'DELETE', path: `/api/groups/${g.id}/members/${removable.membershipId}`, success: 204 },
    PROMOTE_MEMBERS: { method: 'PUT', path: `/api/groups/${g.id}/members/${removable.membershipId}/promote`, success: 200 },
    EDIT_GROUP: { method: 'PUT', path: `/api/groups/${g.id}/details`, data: { city: 'Curitiba', schedules: [] }, success: 200 },
    SCHEDULE_GAMES: { method: 'POST', path: `/api/groups/${g.id}/matches`, data: schedule, success: 201 },
    CANCEL_GAMES: { method: 'DELETE', path: `/api/matches/${g.match.id}`, success: 204 },
    MANAGE_MATCH_PLAYERS: { method: 'POST', path: `/api/matches/${g.match.id}/rental-goalkeepers`, data: { displayName: 'Aluguel QA' }, success: 200 },
    MANAGE_PAYMENTS: { method: 'PUT', path: `/api/matches/${g.match.id}/payments/${target.user.id}/confirm`, success: 200 },
    MANAGE_TEAMS: { method: 'POST', path: `/api/matches/${g.match.id}/teams/generate`, success: 200 },
    MANAGE_LIVE_MATCH: { method: 'PUT', path: `/api/matches/${g.match.id}/live/start`, success: 200 },
    EDIT_PLAYER_PROFILES: { method: 'PUT', path: `/api/groups/${g.id}/members/${target.membershipId}/technical-profile`, data: { ratings: ratings(8) }, success: 200 },
  };
  const action = actions[permission];
  const execute = () => request.fetch(action.path, { method: action.method, headers: auth(admin), data: action.data });
  expect((await execute()).status()).toBe(403);
  const grant = `/api/groups/${g.id}/members/${admin.membershipId}/permissions`;
  await body(await request.put(grant, { headers: auth(g.owner), data: { permissions: [permission] } }));
  await body(await execute(), action.success);
  await body(await request.put(grant, { headers: auth(g.owner), data: { permissions: [] } }));
  expect((await execute()).status()).toBe(403);
  expect((await request.delete(`/api/groups/${g.id}`, { headers: auth(admin) })).status()).toBe(403);
});
