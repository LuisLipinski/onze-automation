import { test, expect } from '../support/test';
import { preparedMatch, liveMatch, auth, body, promote, going } from '../support/factory';

const token = (id: string) => `ExponentPushToken[qa_${id.replaceAll('-', '')}]`;
const flatten = (batches: any[]) => batches.flatMap(batch => Array.isArray(batch) ? batch : [batch]);

test('payment reminders deduplicate, have correct recipient/route and become obsolete after report', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const player = g.members[1];
  await control.process();
  await body(await request.put('/api/devices/push-token', { headers: auth(player), data: { token: token(player.user.id) } }), 204);
  const path = `/api/matches/${g.match.id}/payments/${player.user.id}/reminder`;
  await body(await request.post(path, { headers: auth(g.owner) }));
  await body(await request.post(path, { headers: auth(g.owner) }));
  let jobs = (await control.call('/outbox')).filter((j: any) => j.notification_type === 'PAYMENT_REMINDER' && j.recipient_user_id === player.user.id);
  expect(jobs).toHaveLength(1);
  await control.process();
  let messages = flatten(await control.call('/pushes')).filter(m => m.data.notificationType === 'PAYMENT_REMINDER');
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ to: token(player.user.id), data: { route: '/match', matchId: g.match.id } });
  await control.advance(6 * 60000);
  await body(await request.post(path, { headers: auth(g.owner) }));
  await body(await request.put(`/api/matches/${g.match.id}/payment/reported`, { headers: auth(player) }));
  await control.process();
  messages = flatten(await control.call('/pushes')).filter(m => m.data.notificationType === 'PAYMENT_REMINDER');
  expect(messages).toHaveLength(1);
});

test('Expo transport failure retries and rejected device is deactivated without retrying it', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const player = g.members[1];
  await control.process();
  await body(await request.put('/api/devices/push-token', { headers: auth(player), data: { token: token(player.user.id) } }), 204);
  const path = `/api/matches/${g.match.id}/payments/${player.user.id}/reminder`;
  await body(await request.post(path, { headers: auth(g.owner) }));
  await control.call('/expo-plan', { status: 500, body: { errors: [{ code: 'INTERNAL', message: 'retry' }] } });
  await control.process();
  let job = (await control.call('/outbox')).find((j: any) => j.notification_type === 'PAYMENT_REMINDER' && j.recipient_user_id === player.user.id);
  expect(job).toMatchObject({ status: 'PENDING', attempts: 1 });
  await control.advance(2 * 60000);
  await control.process();
  job = (await control.call('/outbox')).find((j: any) => j.notification_type === 'PAYMENT_REMINDER' && j.recipient_user_id === player.user.id);
  expect(job.status).toBe('SENT');
  expect(flatten(await control.call('/pushes'))).toHaveLength(2);
  await control.advance(6 * 60000);
  await body(await request.post(path, { headers: auth(g.owner) }));
  await control.call('/expo-plan', { status: 200, body: { data: [{ status: 'error', message: 'unregistered', details: { error: 'DeviceNotRegistered' } }] } });
  await control.process();
  const devices = await control.call('/devices');
  expect(devices.find((d: any) => d.user_id === player.user.id).active).toBe(false);
});

test('SSE delivers actual goal updates and snapshots while other groups remain isolated', async ({ request, control, baseURL, observations }) => {
  const g = await liveMatch(request, control);
  const path = `/api/matches/live/stream?matchId=${g.match.id}`;
  const abort = new AbortController();
  const response = await fetch(baseURL + path, { headers: auth(g.members[0]), signal: abort.signal });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  observations.push({ method: 'GET', path: '/api/matches/live/stream', status: response.status });
  const events: any[] = [];
  const reader = response.body!.getReader();
  const pump = (async () => {
    let buffer = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += new TextDecoder().decode(chunk.value).replaceAll('\r', '');
        let split: number;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2);
          const data = frame.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).join('\n');
          if (data) events.push(JSON.parse(data));
        }
      }
    } catch (error) { if (!abort.signal.aborted) throw error; }
  })();
  try {
    await expect.poll(() => events.some(e => e.connected === true)).toBe(true);
    const foreign = await liveMatch(request, control);
    const scorer = g.assignments[0];
    await body(await request.post(`/api/matches/${g.match.id}/live/goals`, { headers: auth(g.owner), data: { scorerAssignmentId: scorer.id, penalty: false } }), 201);
    await expect.poll(() => events.some(e => e.liveMatch?.goalEvents?.length === 1)).toBe(true);
    const changed = events.find(e => e.liveMatch?.goalEvents?.length === 1);
    expect(changed.matchId).toBe(g.match.id);
    expect(changed.liveMatch.goalEvents[0].scorerAssignmentId).toBe(scorer.id);
    expect(events.some(e => e.matchId === foreign.match.id)).toBe(false);
    const denied = await request.get(`/api/matches/live/stream?matchId=${foreign.match.id}`, { headers: { ...auth(g.members[0]), Accept: 'text/event-stream, application/json' } });
    expect(denied.status()).toBe(403);
  } finally { abort.abort(); await reader.cancel().catch(() => {}); await pump; }
});

test('deleting group delivers persisted notices and a deletion push to former members', async ({ request, control }) => {
  const g = await preparedMatch(request, control);
  const member = g.members[0];
  await control.process();
  await body(await request.put('/api/devices/push-token', { headers: auth(member), data: { token: token(member.user.id) } }), 204);
  await body(await request.delete(`/api/groups/${g.id}`, { headers: auth(g.owner) }), 204);
  await control.process();
  const messages = flatten(await control.call('/pushes')).filter(m => m.data.notificationType === 'GROUP_DELETED');
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({ to: token(member.user.id), data: { groupId: g.id, route: '/groups' } });
  const notices = await body(await request.get('/api/groups/deletion-notices', { headers: auth(member) }));
  expect(notices[0].id).toBe(messages[0].data.noticeId);
});

test('persistent provider failure reaches FAILED and stops after the bounded retry limit', async ({ request, control }) => {
  const g = await preparedMatch(request, control, { paymentRequired: true, goalkeeperPays: true });
  const player = g.members[1];
  await control.process();
  await body(await request.put('/api/devices/push-token', { headers: auth(player), data: { token: token(player.user.id) } }), 204);
  await body(await request.post(`/api/matches/${g.match.id}/payments/${player.user.id}/reminder`, { headers: auth(g.owner) }));
  for (let attempt = 1; attempt <= 5; attempt++) {
    await control.call('/expo-plan', { status: 503, body: { errors: [{ message: 'unavailable' }] } });
    await control.process();
    const job = (await control.call('/outbox')).find((j: any) => j.notification_type === 'PAYMENT_REMINDER' && j.recipient_user_id === player.user.id);
    expect(job).toMatchObject({ attempts: attempt, status: attempt === 5 ? 'FAILED' : 'PENDING' });
    await control.advance(2 ** (attempt - 1) * 60000 + 1000);
  }
  await control.process();
  expect(flatten(await control.call('/pushes'))).toHaveLength(5);
});
