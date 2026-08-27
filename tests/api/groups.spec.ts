import { expect, test } from '@playwright/test';

type AuthBody = {
  accessToken: string;
  user: { id: string; email: string; displayName: string };
};

type GroupBody = {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  city: string | null;
  mascot: string | null;
  venue: string | null;
  schedules: Array<{ dayOfWeek: string; startTime: string }>;
  role: 'PRIMARY_ADMIN' | 'ADMIN' | 'MEMBER';
};

async function registerUser(request: any, label: string): Promise<AuthBody> {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `${label}-${unique}@onze.test`;
  const response = await request.post('/api/auth/register', {
    data: {
      email,
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

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test.describe('P1 - grupos', () => {
  test('deve criar grupo, enviar foto, tornar o criador administrador principal, completar dados e gerar convite', async ({
    request,
  }) => {
    const creator = await registerUser(request, 'grupo');

    const createResponse = await request.post('/api/groups', {
      headers: auth(creator.accessToken),
      data: {
        name: 'Pelada QA',
        description: 'Grupo criado pela automação da P1',
      },
    });
    expect(createResponse.status()).toBe(201);

    const group = (await createResponse.json()) as GroupBody;
    expect(group.name).toBe('Pelada QA');
    expect(group.description).toBe('Grupo criado pela automação da P1');
    expect(group.role).toBe('PRIMARY_ADMIN');
    expect(group.photoUrl).toBeNull();

    const photoResponse = await request.post(`/api/groups/${group.id}/photo`, {
      headers: auth(creator.accessToken),
      multipart: {
        photo: {
          name: 'group-photo.png',
          mimeType: 'image/png',
          buffer: tinyPng,
        },
      },
    });
    expect(photoResponse.status()).toBe(200);
    const withPhoto = (await photoResponse.json()) as GroupBody;
    expect(withPhoto.photoUrl).toMatch(/^https:\/\/res\.cloudinary\.com\//);

    const detailsResponse = await request.put(`/api/groups/${group.id}/details`, {
      headers: auth(creator.accessToken),
      data: {
        city: 'Curitiba',
        mascot: 'Leão',
        venue: 'Arena QA',
        schedules: [
          { dayOfWeek: 'THURSDAY', startTime: '20:00:00' },
          { dayOfWeek: 'MONDAY', startTime: '19:30:00' },
        ],
      },
    });
    expect(detailsResponse.status()).toBe(200);

    const configured = (await detailsResponse.json()) as GroupBody;
    expect(configured.city).toBe('Curitiba');
    expect(configured.mascot).toBe('Leão');
    expect(configured.venue).toBe('Arena QA');
    expect(configured.photoUrl).toBe(withPhoto.photoUrl);
    expect(configured.schedules).toEqual([
      { dayOfWeek: 'MONDAY', startTime: '19:30:00' },
      { dayOfWeek: 'THURSDAY', startTime: '20:00:00' },
    ]);

    const listResponse = await request.get('/api/groups', {
      headers: auth(creator.accessToken),
    });
    expect(listResponse.status()).toBe(200);
    const groups = (await listResponse.json()) as GroupBody[];
    expect(
      groups.some(
        (item) =>
          item.id === group.id && item.role === 'PRIMARY_ADMIN' && item.photoUrl === withPhoto.photoUrl,
      ),
    ).toBeTruthy();

    const inviteResponse = await request.post(`/api/groups/${group.id}/invite`, {
      headers: auth(creator.accessToken),
    });
    expect(inviteResponse.status()).toBe(200);
    const invite = await inviteResponse.json();
    expect(invite.groupId).toBe(group.id);
    expect(invite.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(invite.deepLink).toBe(`onze://join/${invite.code}`);

    const repeatedInviteResponse = await request.post(`/api/groups/${group.id}/invite`, {
      headers: auth(creator.accessToken),
    });
    expect(repeatedInviteResponse.status()).toBe(200);
    await expect(repeatedInviteResponse.json()).resolves.toEqual(invite);
  });

  test('deve bloquear outro usuário de alterar grupo e gerar convite', async ({ request }) => {
    const creator = await registerUser(request, 'admin');
    const outsider = await registerUser(request, 'outsider');

    const createResponse = await request.post('/api/groups', {
      headers: auth(creator.accessToken),
      data: { name: 'Grupo protegido' },
    });
    expect(createResponse.status()).toBe(201);
    const group = (await createResponse.json()) as GroupBody;

    const updateResponse = await request.put(`/api/groups/${group.id}/details`, {
      headers: auth(outsider.accessToken),
      data: { city: 'Outra cidade', schedules: [] },
    });
    expect(updateResponse.status()).toBe(403);
    await expect(updateResponse.json()).resolves.toMatchObject({ code: 'GROUP_ACCESS_DENIED' });

    const inviteResponse = await request.post(`/api/groups/${group.id}/invite`, {
      headers: auth(outsider.accessToken),
    });
    expect(inviteResponse.status()).toBe(403);
    await expect(inviteResponse.json()).resolves.toMatchObject({ code: 'GROUP_ACCESS_DENIED' });
  });

  test('deve exigir autenticação e nome do grupo', async ({ request }) => {
    const noAuth = await request.post('/api/groups', { data: { name: 'Sem sessão' } });
    expect(noAuth.status()).toBe(401);

    const user = await registerUser(request, 'validacao');
    const blankName = await request.post('/api/groups', {
      headers: auth(user.accessToken),
      data: { name: '   ' },
    });
    expect(blankName.status()).toBe(400);
  });
});
