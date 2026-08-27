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

test('deve reutilizar o mesmo convite para várias pessoas e permitir regeneração pelo admin', async ({
  request,
}) => {
  const creator = await registerUser(request, 'invite-admin');
  const firstMember = await registerUser(request, 'invite-member-1');
  const secondMember = await registerUser(request, 'invite-member-2');
  const afterRegeneration = await registerUser(request, 'invite-member-new');

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

  for (const member of [firstMember, secondMember]) {
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
  }

  const repeatJoinResponse = await request.post('/api/groups/join', {
    headers: auth(firstMember.accessToken),
    data: { code: invite.code },
  });
  expect(repeatJoinResponse.status()).toBe(200);
  await expect(repeatJoinResponse.json()).resolves.toMatchObject({
    groupId: group.id,
    role: 'MEMBER',
    alreadyMember: true,
  });

  const secondMemberGroupsResponse = await request.get('/api/groups', {
    headers: auth(secondMember.accessToken),
  });
  expect(secondMemberGroupsResponse.status()).toBe(200);
  const secondMemberGroups = (await secondMemberGroupsResponse.json()) as GroupBody[];
  expect(
    secondMemberGroups.some((item) => item.id === group.id && item.role === 'MEMBER'),
  ).toBeTruthy();

  const regenerateResponse = await request.post(`/api/groups/${group.id}/invite/regenerate`, {
    headers: auth(creator.accessToken),
  });
  expect(regenerateResponse.status()).toBe(200);
  const regenerated = await regenerateResponse.json();
  expect(regenerated.code).toMatch(/^[A-Z2-9]{8}$/);
  expect(regenerated.code).not.toBe(invite.code);
  expect(regenerated.deepLink).toBe(`onze://join/${regenerated.code}`);

  const oldCodeResponse = await request.post('/api/groups/join', {
    headers: auth(afterRegeneration.accessToken),
    data: { code: invite.code },
  });
  expect(oldCodeResponse.status()).toBe(400);
  await expect(oldCodeResponse.json()).resolves.toMatchObject({
    code: 'INVALID_GROUP_INVITE',
  });

  const newCodeResponse = await request.post('/api/groups/join', {
    headers: auth(afterRegeneration.accessToken),
    data: { code: regenerated.code },
  });
  expect(newCodeResponse.status()).toBe(200);
  await expect(newCodeResponse.json()).resolves.toMatchObject({
    groupId: group.id,
    role: 'MEMBER',
    alreadyMember: false,
  });
});
