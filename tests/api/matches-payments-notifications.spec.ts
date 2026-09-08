import { type APIRequestContext, expect, test } from '@playwright/test';

type AuthBody = {
  accessToken: string;
  user: { id: string; displayName: string };
};

type GroupBody = {
  id: string;
};

type InviteBody = {
  code: string;
};

type AttendanceBody = {
  userId: string;
  status: 'GOING' | 'NOT_GOING';
  paymentStatus: 'PENDING' | 'REPORTED' | 'PAID' | 'CANCELLED' | null;
  paymentSettlementStatus: 'PENDING' | 'REVIEW_REQUIRED' | 'REFUNDED' | null;
  replacementUserId: string | null;
  settlementAvailable: boolean;
};

type MatchBody = {
  id: string;
  recurrence: 'NONE' | 'WEEKLY';
  status: 'SCHEDULED' | 'CANCELLED';
  attendanceOpen: boolean;
  paymentRequired: boolean;
  paymentAmount: number | null;
  pixKey: string | null;
  goingCount: number;
  notGoingCount: number;
  myAttendance: 'GOING' | 'NOT_GOING' | null;
  myPaymentStatus: 'PENDING' | 'REPORTED' | 'PAID' | 'CANCELLED' | null;
  myPaymentSettlementStatus: 'PENDING' | 'REVIEW_REQUIRED' | 'REFUNDED' | null;
  attendances: AttendanceBody[];
};

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function futureDate(daysFromNow: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(Date.now() + daysFromNow * 86_400_000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function registerUser(request: APIRequestContext, label: string): Promise<AuthBody> {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const emailLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const response = await request.post('/api/auth/register', {
    data: {
      email: `${emailLabel}-${unique}@onze.test`,
      password: 'OnzeTest123!',
      displayName: label,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function createGroupWithMembers(
  request: APIRequestContext,
  primary: AuthBody,
  members: AuthBody[],
  label: string,
): Promise<GroupBody> {
  const createResponse = await request.post('/api/groups', {
    headers: auth(primary.accessToken),
    data: { name: `${label} ${Date.now()}` },
  });
  expect(createResponse.status()).toBe(201);
  const group = (await createResponse.json()) as GroupBody;

  const inviteResponse = await request.post(`/api/groups/${group.id}/invite`, {
    headers: auth(primary.accessToken),
  });
  expect(inviteResponse.status()).toBe(200);
  const invite = (await inviteResponse.json()) as InviteBody;

  for (const member of members) {
    const joinResponse = await request.post('/api/groups/join', {
      headers: auth(member.accessToken),
      data: { code: invite.code },
    });
    expect(joinResponse.status()).toBe(200);
  }

  return group;
}

function oneOffMatch(maxPlayers: number, paymentRequired = false) {
  return {
    date: futureDate(3),
    startTime: '20:30:00',
    timeZone: 'America/Sao_Paulo',
    venue: 'Arena Onze QA',
    maxPlayers,
    paymentRequired,
    notes: 'Criada pela automação externa',
    recurrence: 'NONE',
  };
}

async function updateAttendance(
  request: APIRequestContext,
  matchId: string,
  user: AuthBody,
  status: 'GOING' | 'NOT_GOING',
) {
  return request.put(`/api/matches/${matchId}/attendance`, {
    headers: auth(user.accessToken),
    data: { status },
  });
}

test.describe('P2, P6 e P7 - partidas, pagamentos e notificações', () => {
  test('deve controlar partida avulsa, vagas, presença e cancelamento', async ({ request }) => {
    const primary = await registerUser(request, 'Principal Partida QA');
    const first = await registerUser(request, 'Primeiro Jogador QA');
    const second = await registerUser(request, 'Segundo Jogador QA');
    const group = await createGroupWithMembers(
      request,
      primary,
      [first, second],
      'Pelada Partida QA',
    );

    const createResponse = await request.post(`/api/groups/${group.id}/matches`, {
      headers: auth(primary.accessToken),
      data: oneOffMatch(2),
    });
    expect(createResponse.status()).toBe(201);
    const match = (await createResponse.json()) as MatchBody;
    expect(match).toMatchObject({
      recurrence: 'NONE',
      attendanceOpen: true,
      goingCount: 0,
    });

    const unauthorizedCreate = await request.post(`/api/groups/${group.id}/matches`, {
      headers: auth(first.accessToken),
      data: oneOffMatch(10),
    });
    expect(unauthorizedCreate.status()).toBe(403);
    await expect(unauthorizedCreate.json()).resolves.toMatchObject({ code: 'GROUP_ACCESS_DENIED' });

    const primaryGoing = await updateAttendance(request, match.id, primary, 'GOING');
    expect(primaryGoing.status()).toBe(200);
    await expect(primaryGoing.json()).resolves.toMatchObject({ goingCount: 1, myAttendance: 'GOING' });

    const firstGoing = await updateAttendance(request, match.id, first, 'GOING');
    expect(firstGoing.status()).toBe(200);
    await expect(firstGoing.json()).resolves.toMatchObject({ goingCount: 2 });

    const fullResponse = await updateAttendance(request, match.id, second, 'GOING');
    expect(fullResponse.status()).toBe(409);
    await expect(fullResponse.json()).resolves.toMatchObject({ code: 'MATCH_FULL' });

    const primaryLeaves = await updateAttendance(request, match.id, primary, 'NOT_GOING');
    expect(primaryLeaves.status()).toBe(200);
    await expect(primaryLeaves.json()).resolves.toMatchObject({ goingCount: 1, notGoingCount: 1 });

    const secondGoing = await updateAttendance(request, match.id, second, 'GOING');
    expect(secondGoing.status()).toBe(200);
    await expect(secondGoing.json()).resolves.toMatchObject({ goingCount: 2 });

    const upcomingResponse = await request.get('/api/matches/upcoming', {
      headers: auth(first.accessToken),
    });
    expect(upcomingResponse.status()).toBe(200);
    const upcoming = (await upcomingResponse.json()) as MatchBody[];
    expect(upcoming.find((item) => item.id === match.id)?.attendances).toHaveLength(3);

    const unauthorizedCancellation = await request.delete(`/api/matches/${match.id}`, {
      headers: auth(first.accessToken),
    });
    expect(unauthorizedCancellation.status()).toBe(403);

    const cancellation = await request.delete(`/api/matches/${match.id}`, {
      headers: auth(primary.accessToken),
    });
    expect(cancellation.status()).toBe(204);

    const cancelledResponse = await request.get(`/api/matches/${match.id}`, {
      headers: auth(first.accessToken),
    });
    expect(cancelledResponse.status()).toBe(200);
    await expect(cancelledResponse.json()).resolves.toMatchObject({
      status: 'CANCELLED',
      attendanceOpen: false,
    });
  });

  test('deve preservar privacidade e exigir reposição antes do reembolso', async ({ request }) => {
    const primary = await registerUser(request, 'Principal Pagamento QA');
    const member = await registerUser(request, 'Jogador Pagamento QA');
    const replacement = await registerUser(request, 'Jogador Reposicao QA');
    const group = await createGroupWithMembers(
      request,
      primary,
      [member, replacement],
      'Pelada Pagamento QA',
    );

    const configureResponse = await request.put(`/api/groups/${group.id}/details`, {
      headers: auth(primary.accessToken),
      data: {
        defaultPaymentEnabled: true,
        defaultPaymentAmount: 25.5,
        defaultPixKey: 'pix-qa@onze.test',
        schedules: [],
      },
    });
    expect(configureResponse.status()).toBe(200);

    const createResponse = await request.post(`/api/groups/${group.id}/matches`, {
      headers: auth(primary.accessToken),
      data: oneOffMatch(2, true),
    });
    expect(createResponse.status()).toBe(201);
    const match = (await createResponse.json()) as MatchBody;
    expect(match).toMatchObject({
      paymentRequired: true,
      paymentAmount: 25.5,
      pixKey: 'pix-qa@onze.test',
    });

    for (const player of [primary, member]) {
      const attendanceResponse = await updateAttendance(request, match.id, player, 'GOING');
      expect(attendanceResponse.status()).toBe(200);
    }

    const reportResponse = await request.put(`/api/matches/${match.id}/payment/reported`, {
      headers: auth(member.accessToken),
    });
    expect(reportResponse.status()).toBe(200);
    await expect(reportResponse.json()).resolves.toMatchObject({ myPaymentStatus: 'REPORTED' });

    const selfConfirmResponse = await request.put(
      `/api/matches/${match.id}/payments/${member.user.id}/confirm`,
      { headers: auth(member.accessToken) },
    );
    expect(selfConfirmResponse.status()).toBe(403);

    const confirmResponse = await request.put(
      `/api/matches/${match.id}/payments/${member.user.id}/confirm`,
      { headers: auth(primary.accessToken) },
    );
    expect(confirmResponse.status()).toBe(200);
    const confirmed = (await confirmResponse.json()) as MatchBody;
    expect(confirmed.attendances.find((item) => item.userId === member.user.id)?.paymentStatus).toBe(
      'PAID',
    );

    const memberViewResponse = await request.get(`/api/matches/${match.id}`, {
      headers: auth(member.accessToken),
    });
    expect(memberViewResponse.status()).toBe(200);
    const memberView = (await memberViewResponse.json()) as MatchBody;
    expect(memberView.myPaymentStatus).toBe('PAID');
    expect(
      memberView.attendances.find((item) => item.userId === primary.user.id)?.paymentStatus,
    ).toBeNull();

    const withdrawalResponse = await updateAttendance(request, match.id, member, 'NOT_GOING');
    expect(withdrawalResponse.status()).toBe(200);
    const withdrawn = (await withdrawalResponse.json()) as MatchBody;
    expect(withdrawn.myPaymentSettlementStatus).toBe('PENDING');
    expect(
      withdrawn.attendances.find((item) => item.userId === member.user.id)?.settlementAvailable,
    ).toBe(false);

    const earlyRefundResponse = await request.put(
      `/api/matches/${match.id}/payments/${member.user.id}/settlement`,
      {
        headers: auth(primary.accessToken),
        data: { resolution: 'REFUNDED' },
      },
    );
    expect(earlyRefundResponse.status()).toBe(409);
    await expect(earlyRefundResponse.json()).resolves.toMatchObject({
      code: 'REPLACEMENT_REQUIRED_FOR_SETTLEMENT',
    });

    const replacementResponse = await request.put(
      `/api/matches/${match.id}/replacements/${member.user.id}`,
      {
        headers: auth(primary.accessToken),
        data: { replacementUserId: replacement.user.id },
      },
    );
    expect(replacementResponse.status()).toBe(200);
    const withReplacement = (await replacementResponse.json()) as MatchBody;
    expect(withReplacement.goingCount).toBe(2);
    expect(
      withReplacement.attendances.find((item) => item.userId === member.user.id),
    ).toMatchObject({
      replacementUserId: replacement.user.id,
      settlementAvailable: true,
    });

    const refundResponse = await request.put(
      `/api/matches/${match.id}/payments/${member.user.id}/settlement`,
      {
        headers: auth(primary.accessToken),
        data: { resolution: 'REFUNDED' },
      },
    );
    expect(refundResponse.status()).toBe(200);
    const refunded = (await refundResponse.json()) as MatchBody;
    expect(
      refunded.attendances.find((item) => item.userId === member.user.id)
        ?.paymentSettlementStatus,
    ).toBe('REFUNDED');
  });

  test('deve registrar, validar e remover token Expo do dispositivo', async ({ request }) => {
    const user = await registerUser(request, 'Push Token QA');
    const token = `ExpoPushToken[qa_${Date.now()}]`;

    const registerResponse = await request.put('/api/devices/push-token', {
      headers: auth(user.accessToken),
      data: { token },
    });
    expect(registerResponse.status()).toBe(204);

    const invalidResponse = await request.put('/api/devices/push-token', {
      headers: auth(user.accessToken),
      data: { token: 'token-invalido' },
    });
    expect(invalidResponse.status()).toBe(400);

    const unregisterResponse = await request.delete(
      `/api/devices/push-token?token=${encodeURIComponent(token)}`,
      { headers: auth(user.accessToken) },
    );
    expect(unregisterResponse.status()).toBe(204);
  });
});
