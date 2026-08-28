import { expect, test } from '@playwright/test';

type AuthBody = {
  accessToken: string;
};

type GroupBody = {
  id: string;
};

type InviteBody = {
  code: string;
};

async function registerUser(request: any, label: string): Promise<AuthBody> {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await request.post('/api/auth/register', {
    data: {
      email: `${label}-${unique}@onze.test`,
      password: 'OnzeTest123!',
      displayName: label,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test('membro sai do grupo e principal precisa transferir antes', async ({ request }) => {
  const primary = await registerUser(request, 'Principal Saida QA');
  const member = await registerUser(request, 'Membro Saida QA');

  const createResponse = await request.post('/api/groups', {
    headers: auth(primary.accessToken),
    data: { name: 'Pelada Saida QA' },
  });
  expect(createResponse.status()).toBe(201);
  const group = (await createResponse.json()) as GroupBody;

  const inviteResponse = await request.post(`/api/groups/${group.id}/invite`, {
    headers: auth(primary.accessToken),
  });
  expect(inviteResponse.status()).toBe(200);
  const invite = (await inviteResponse.json()) as InviteBody;

  const joinResponse = await request.post('/api/groups/join', {
    headers: auth(member.accessToken),
    data: { code: invite.code },
  });
  expect(joinResponse.status()).toBe(200);

  const leaveResponse = await request.delete(`/api/groups/${group.id}/members/me`, {
    headers: auth(member.accessToken),
  });
  expect(leaveResponse.status()).toBe(204);

  const memberGroupsResponse = await request.get('/api/groups', {
    headers: auth(member.accessToken),
  });
  expect(memberGroupsResponse.status()).toBe(200);
  const memberGroups = (await memberGroupsResponse.json()) as GroupBody[];
  expect(memberGroups.some((item) => item.id === group.id)).toBeFalsy();

  const primaryLeaveResponse = await request.delete(`/api/groups/${group.id}/members/me`, {
    headers: auth(primary.accessToken),
  });
  expect(primaryLeaveResponse.status()).toBe(409);
  await expect(primaryLeaveResponse.json()).resolves.toMatchObject({
    code: 'PRIMARY_ADMIN_TRANSFER_REQUIRED',
  });
});
