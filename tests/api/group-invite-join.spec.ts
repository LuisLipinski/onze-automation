import { expect, test } from '@playwright/test';

type AuthBody = {
  accessToken: string;
};

type GroupBody = {
  id: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
};

async function registerUser(request: any, label: string): Promise<AuthBody> {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await request.post('/api/auth/register', {
    data: {
      email: `${label}-${unique}@onze.test`,
      password: 'OnzeTest123!',
      displayName: `QA ${label}`,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test('deve permitir que outro usuário entre no grupo pelo código do convite', async ({ request }) => {
  const creator = await registerUser(request, 'invite-admin');
  const member = await registerUser(request, 'invite-member');

  const createResponse = await request.post('/api/groups', {
    headers: auth(creator.accessToken),
    data: { name: 'Pelada Convite QA' },
  });
  expect(createResponse.status()).toBe(201);
  const group = (await createResponse.json()) as GroupBody;

  const inviteResponse = await request.post(`/api/groups/${group.id}/invite`, {
    headers: auth(creator.accessToken),
  });
  expect(inviteResponse.status()).toBe(200);
  const invite = await inviteResponse.json();

  const joinResponse = await request.post('/api/groups/join', {
    headers: auth(member.accessToken),
    data: { code: invite.code.toLowerCase() },
  });
  expect(joinResponse.status()).toBe(200);
  await expect(joinResponse.json()).resolves.toMatchObject({
    groupId: group.id,
    groupName: 'Pelada Convite QA',
    role: 'MEMBER',
    alreadyMember: false,
  });

  const memberGroupsResponse = await request.get('/api/groups', {
    headers: auth(member.accessToken),
  });
  expect(memberGroupsResponse.status()).toBe(200);
  const memberGroups = (await memberGroupsResponse.json()) as GroupBody[];
  expect(
    memberGroups.some((item) => item.id === group.id && item.role === 'MEMBER'),
  ).toBeTruthy();

  const repeatJoinResponse = await request.post('/api/groups/join', {
    headers: auth(member.accessToken),
    data: { code: invite.code },
  });
  expect(repeatJoinResponse.status()).toBe(200);
  await expect(repeatJoinResponse.json()).resolves.toMatchObject({
    groupId: group.id,
    role: 'MEMBER',
    alreadyMember: true,
  });
});
