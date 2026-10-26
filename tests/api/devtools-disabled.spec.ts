import { test, expect } from '../support/test';
import { preparedMatch, auth, body } from '../support/factory';

test('test tools are absent by default even for the principal and capabilities stay false', async ({ request, control }) => {
  const g = await preparedMatch(request, control);
  expect(g.match.canManageTestData).toBe(false);
  const teams = await body(await request.get(`/api/matches/${g.match.id}/teams`, { headers: auth(g.owner) }));
  expect(teams.canManageTestData).toBe(false);
  const path = `/api/dev/test-data/matches/${g.match.id}`;
  for (const [method, suffix, data] of [['GET','',undefined],['POST','/generate',{count: 4}],['PUT','/scenario',{scenario: 'BALANCED'}],['POST','/attendance',undefined],['DELETE','/attendance',undefined]] as const) {
    expect((await request.fetch(path + suffix, { method, headers: auth(g.owner), data })).status()).toBe(404);
  }
});
