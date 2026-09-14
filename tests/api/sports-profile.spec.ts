import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

type AuthBody = {
  accessToken: string;
};

type GroupBody = {
  id: string;
};

type InviteBody = {
  code: string;
};

type MemberBody = {
  membershipId: string;
  displayName: string;
  role: 'PRIMARY_ADMIN' | 'ADMIN' | 'MEMBER';
  positions: string[];
  canPlayGoalkeeper: boolean;
  dominantFoot: string | null;
  technicalLevel: number | null;
  sportsProfileComplete: boolean;
};

type SportsProfileBody = {
  membershipId: string;
  displayName: string;
  positions: string[];
  canPlayGoalkeeper: boolean;
  dominantFoot: string | null;
  technicalLevel: number | null;
  complete: boolean;
};

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

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function createGroup(
  request: APIRequestContext,
  user: AuthBody,
  name: string,
): Promise<GroupBody> {
  const response = await request.post('/api/groups', {
    headers: auth(user.accessToken),
    data: { name },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function inviteToGroup(
  request: APIRequestContext,
  primary: AuthBody,
  groupId: string,
): Promise<InviteBody> {
  const response = await request.post(`/api/groups/${groupId}/invite`, {
    headers: auth(primary.accessToken),
  });
  expect(response.status()).toBe(200);
  return response.json();
}

async function joinGroup(
  request: APIRequestContext,
  user: AuthBody,
  code: string,
) {
  const response = await request.post('/api/groups/join', {
    headers: auth(user.accessToken),
    data: { code },
  });
  expect(response.status()).toBe(200);
}

test('deve manter o perfil esportivo independente por grupo e validar a autoedição', async ({ request }) => {
  const player = await registerUser(request, 'Perfil Próprio QA');
  const firstGroup = await createGroup(request, player, 'Perfil Grupo Um QA');
  const secondGroup = await createGroup(request, player, 'Perfil Grupo Dois QA');

  const initialResponse = await request.get(
    `/api/groups/${firstGroup.id}/members/me/sports-profile`,
    { headers: auth(player.accessToken) },
  );
  expect(initialResponse.status()).toBe(200);
  await expect(initialResponse.json()).resolves.toMatchObject({
    positions: [],
    canPlayGoalkeeper: false,
    dominantFoot: null,
    technicalLevel: null,
    complete: false,
  });

  const invalidResponse = await request.put(
    `/api/groups/${firstGroup.id}/members/me/sports-profile`,
    {
      headers: auth(player.accessToken),
      data: {
        positions: [],
        canPlayGoalkeeper: false,
        dominantFoot: 'RIGHT',
      },
    },
  );
  expect(invalidResponse.status()).toBe(400);
  await expect(invalidResponse.json()).resolves.toMatchObject({ code: 'INVALID_SPORTS_PROFILE' });

  const updateResponse = await request.put(
    `/api/groups/${firstGroup.id}/members/me/sports-profile`,
    {
      headers: auth(player.accessToken),
      data: {
        positions: ['DEFENDER', 'WINGER'],
        canPlayGoalkeeper: true,
        dominantFoot: 'LEFT',
      },
    },
  );
  expect(updateResponse.status()).toBe(200);
  const updated = (await updateResponse.json()) as SportsProfileBody;
  expect(updated.positions).toHaveLength(2);
  expect(updated.positions).toEqual(expect.arrayContaining(['DEFENDER', 'WINGER']));
  expect(updated.canPlayGoalkeeper).toBe(true);
  expect(updated.dominantFoot).toBe('LEFT');
  expect(updated.technicalLevel).toBeNull();
  expect(updated.complete).toBe(true);

  const otherGroupResponse = await request.get(
    `/api/groups/${secondGroup.id}/members/me/sports-profile`,
    { headers: auth(player.accessToken) },
  );
  expect(otherGroupResponse.status()).toBe(200);
  await expect(otherGroupResponse.json()).resolves.toMatchObject({
    positions: [],
    canPlayGoalkeeper: false,
    dominantFoot: null,
    complete: false,
  });
});

test('deve restringir nível técnico e perfil de terceiros a administradores autorizados', async ({ request }) => {
  const primary = await registerUser(request, 'Perfil Principal QA');
  const delegatedAdmin = await registerUser(request, 'Perfil Admin QA');
  const player = await registerUser(request, 'Perfil Jogador QA');
  const group = await createGroup(request, primary, 'Perfil Administrado QA');
  const invite = await inviteToGroup(request, primary, group.id);
  await joinGroup(request, delegatedAdmin, invite.code);
  await joinGroup(request, player, invite.code);

  const membersResponse = await request.get(`/api/groups/${group.id}/members`, {
    headers: auth(primary.accessToken),
  });
  expect(membersResponse.status()).toBe(200);
  const members = (await membersResponse.json()) as MemberBody[];
  const adminMembership = members.find((member) => member.displayName === 'Perfil Admin QA');
  const playerMembership = members.find((member) => member.displayName === 'Perfil Jogador QA');
  expect(adminMembership).toBeTruthy();
  expect(playerMembership).toBeTruthy();

  const promoteResponse = await request.put(
    `/api/groups/${group.id}/members/${adminMembership!.membershipId}/promote`,
    { headers: auth(primary.accessToken) },
  );
  expect(promoteResponse.status()).toBe(200);

  const memberReadsTarget = await request.get(
    `/api/groups/${group.id}/members/${playerMembership!.membershipId}/sports-profile`,
    { headers: auth(player.accessToken) },
  );
  expect(memberReadsTarget.status()).toBe(403);

  const adminWithoutPermission = await request.put(
    `/api/groups/${group.id}/members/${playerMembership!.membershipId}/sports-profile`,
    {
      headers: auth(delegatedAdmin.accessToken),
      data: {
        positions: ['MIDFIELDER'],
        canPlayGoalkeeper: false,
        dominantFoot: 'BOTH',
        technicalLevel: 3,
      },
    },
  );
  expect(adminWithoutPermission.status()).toBe(403);

  const invalidLevel = await request.put(
    `/api/groups/${group.id}/members/${playerMembership!.membershipId}/sports-profile`,
    {
      headers: auth(primary.accessToken),
      data: {
        positions: ['STRIKER'],
        canPlayGoalkeeper: false,
        dominantFoot: 'RIGHT',
        technicalLevel: 6,
      },
    },
  );
  expect(invalidLevel.status()).toBe(400);

  const grantPermission = await request.put(
    `/api/groups/${group.id}/members/${adminMembership!.membershipId}/permissions`,
    {
      headers: auth(primary.accessToken),
      data: { permissions: ['EDIT_PLAYER_PROFILES'] },
    },
  );
  expect(grantPermission.status()).toBe(200);

  const authorizedUpdate = await request.put(
    `/api/groups/${group.id}/members/${playerMembership!.membershipId}/sports-profile`,
    {
      headers: auth(delegatedAdmin.accessToken),
      data: {
        positions: ['MIDFIELDER'],
        canPlayGoalkeeper: true,
        dominantFoot: 'BOTH',
        technicalLevel: 3,
      },
    },
  );
  expect(authorizedUpdate.status()).toBe(200);
  await expect(authorizedUpdate.json()).resolves.toMatchObject({
    membershipId: playerMembership!.membershipId,
    positions: ['MIDFIELDER'],
    canPlayGoalkeeper: true,
    dominantFoot: 'BOTH',
    technicalLevel: 3,
    complete: true,
  });

  const summaryResponse = await request.get(`/api/groups/${group.id}/members`, {
    headers: auth(primary.accessToken),
  });
  expect(summaryResponse.status()).toBe(200);
  const updatedMembers = (await summaryResponse.json()) as MemberBody[];
  expect(updatedMembers.find((member) => member.membershipId === playerMembership!.membershipId))
    .toMatchObject({
      positions: ['MIDFIELDER'],
      canPlayGoalkeeper: true,
      dominantFoot: 'BOTH',
      technicalLevel: 3,
      sportsProfileComplete: true,
    });

  const otherGroup = await createGroup(request, primary, 'Perfil Isolado QA');
  const crossGroupResponse = await request.get(
    `/api/groups/${otherGroup.id}/members/${playerMembership!.membershipId}/sports-profile`,
    { headers: auth(primary.accessToken) },
  );
  expect(crossGroupResponse.status()).toBe(404);
  await expect(crossGroupResponse.json()).resolves.toMatchObject({ code: 'GROUP_MEMBER_NOT_FOUND' });
});
