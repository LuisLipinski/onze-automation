import { expect, test } from '@playwright/test';

type AuthBody = {
  accessToken: string;
};

type GroupBody = {
  id: string;
  role: 'PRIMARY_ADMIN' | 'ADMIN' | 'MEMBER';
};

type InviteBody = {
  code: string;
};

type MemberBody = {
  membershipId: string;
  displayName: string;
  role: 'PRIMARY_ADMIN' | 'ADMIN' | 'MEMBER';
  permissions: string[];
  currentUser: boolean;
};

async function registerUser(request: any, label: string): Promise<AuthBody> {
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

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test('deve respeitar a hierarquia do administrador principal', async ({ request }) => {
  const primary = await registerUser(request, 'Principal QA');
  const first = await registerUser(request, 'Admin Um QA');
  const second = await registerUser(request, 'Admin Dois QA');

  const createGroupResponse = await request.post('/api/groups', {
    headers: auth(primary.accessToken),
    data: { name: 'Pelada Administradores QA' },
  });
  expect(createGroupResponse.status()).toBe(201);
  const group = (await createGroupResponse.json()) as GroupBody;
  expect(group.role).toBe('PRIMARY_ADMIN');

  const inviteResponse = await request.post(`/api/groups/${group.id}/invite`, {
    headers: auth(primary.accessToken),
  });
  expect(inviteResponse.status()).toBe(200);
  const invite = (await inviteResponse.json()) as InviteBody;

  for (const user of [first, second]) {
    const joinResponse = await request.post('/api/groups/join', {
      headers: auth(user.accessToken),
      data: { code: invite.code },
    });
    expect(joinResponse.status()).toBe(200);
  }

  const membersResponse = await request.get(`/api/groups/${group.id}/members`, {
    headers: auth(primary.accessToken),
  });
  expect(membersResponse.status()).toBe(200);
  let members = (await membersResponse.json()) as MemberBody[];

  const primaryMembership = members.find((member) => member.currentUser);
  const firstMembership = members.find((member) => member.displayName === 'Admin Um QA');
  const secondMembership = members.find((member) => member.displayName === 'Admin Dois QA');
  expect(primaryMembership?.role).toBe('PRIMARY_ADMIN');
  expect(firstMembership?.role).toBe('MEMBER');
  expect(secondMembership?.role).toBe('MEMBER');
  expect(primaryMembership).toBeTruthy();
  expect(firstMembership).toBeTruthy();
  expect(secondMembership).toBeTruthy();

  const promoteFirst = await request.put(
    `/api/groups/${group.id}/members/${firstMembership!.membershipId}/promote`,
    { headers: auth(primary.accessToken) },
  );
  expect(promoteFirst.status()).toBe(200);
  await expect(promoteFirst.json()).resolves.toMatchObject({ role: 'ADMIN' });

  const promoteSecondWithoutPermission = await request.put(
    `/api/groups/${group.id}/members/${secondMembership!.membershipId}/promote`,
    { headers: auth(first.accessToken) },
  );
  expect(promoteSecondWithoutPermission.status()).toBe(403);
  await expect(promoteSecondWithoutPermission.json()).resolves.toMatchObject({
    code: 'GROUP_ACCESS_DENIED',
  });

  const grantPromotePermission = await request.put(
    `/api/groups/${group.id}/members/${firstMembership!.membershipId}/permissions`,
    {
      headers: auth(primary.accessToken),
      data: { permissions: ['PROMOTE_MEMBERS'] },
    },
  );
  expect(grantPromotePermission.status()).toBe(200);
  await expect(grantPromotePermission.json()).resolves.toMatchObject({
    permissions: ['PROMOTE_MEMBERS'],
  });

  const promoteSecondByDelegatedAdmin = await request.put(
    `/api/groups/${group.id}/members/${secondMembership!.membershipId}/promote`,
    { headers: auth(first.accessToken) },
  );
  expect(promoteSecondByDelegatedAdmin.status()).toBe(200);
  await expect(promoteSecondByDelegatedAdmin.json()).resolves.toMatchObject({ role: 'ADMIN' });

  const commonAdminDemoteAttempt = await request.put(
    `/api/groups/${group.id}/members/${secondMembership!.membershipId}/demote`,
    { headers: auth(first.accessToken) },
  );
  expect(commonAdminDemoteAttempt.status()).toBe(403);
  await expect(commonAdminDemoteAttempt.json()).resolves.toMatchObject({
    code: 'PRIMARY_ADMIN_REQUIRED',
  });

  const primaryDemotesSecond = await request.put(
    `/api/groups/${group.id}/members/${secondMembership!.membershipId}/demote`,
    { headers: auth(primary.accessToken) },
  );
  expect(primaryDemotesSecond.status()).toBe(200);
  await expect(primaryDemotesSecond.json()).resolves.toMatchObject({ role: 'MEMBER' });

  const primarySelfDemoteAttempt = await request.put(
    `/api/groups/${group.id}/members/${primaryMembership!.membershipId}/demote`,
    { headers: auth(primary.accessToken) },
  );
  expect(primarySelfDemoteAttempt.status()).toBe(409);
  await expect(primarySelfDemoteAttempt.json()).resolves.toMatchObject({
    code: 'PRIMARY_ADMIN_TRANSFER_REQUIRED',
  });

  const transferToMemberAttempt = await request.put(`/api/groups/${group.id}/primary-admin`, {
    headers: auth(primary.accessToken),
    data: { replacementMemberId: secondMembership!.membershipId },
  });
  expect(transferToMemberAttempt.status()).toBe(400);
  await expect(transferToMemberAttempt.json()).resolves.toMatchObject({
    code: 'REPLACEMENT_MUST_BE_ADMIN',
  });

  const transferResponse = await request.put(`/api/groups/${group.id}/primary-admin`, {
    headers: auth(primary.accessToken),
    data: { replacementMemberId: firstMembership!.membershipId },
  });
  expect(transferResponse.status()).toBe(200);
  members = (await transferResponse.json()) as MemberBody[];

  expect(members.find((member) => member.displayName === 'Principal QA')?.role).toBe('ADMIN');
  expect(members.find((member) => member.displayName === 'Principal QA')?.permissions).toEqual([]);
  expect(members.find((member) => member.displayName === 'Admin Um QA')?.role).toBe('PRIMARY_ADMIN');

  const oldPrimaryPromoteAttempt = await request.put(
    `/api/groups/${group.id}/members/${secondMembership!.membershipId}/promote`,
    { headers: auth(primary.accessToken) },
  );
  expect(oldPrimaryPromoteAttempt.status()).toBe(403);

  const newPrimaryPromotesSecond = await request.put(
    `/api/groups/${group.id}/members/${secondMembership!.membershipId}/promote`,
    { headers: auth(first.accessToken) },
  );
  expect(newPrimaryPromotesSecond.status()).toBe(200);
  await expect(newPrimaryPromotesSecond.json()).resolves.toMatchObject({ role: 'ADMIN' });
});
