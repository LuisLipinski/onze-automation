import { test, expect } from './support/test';
import { auth, body, group, incompleteGroup, profile, ratings } from './support/factory';

test('[UI-P01] perfil esportivo salva posições, goleiro e pé dominante', async ({ ui, request }) => {
  const g = await group(request, 1);
  await ui.login(g.members[0]);
  await ui.open('sports-profile', { groupId: g.id });
  await ui.screen('sports-profile', 'MEU PERFIL ESPORTIVO');
  await ui.tap('Posição principal', true);
  await ui.tap('Meio-campo', true);
  await ui.tap('Deseja adicionar uma segunda posição?');
  await ui.tap('Segunda posição', true);
  await ui.tap('Atacante');
  await ui.tap('Posso jogar no gol quando necessário');
  await ui.tap('Esquerdo');
  await ui.tap('Salvar perfil esportivo');
  await ui.sees('atualizado', true);
  const saved = await body(await request.get(`/api/groups/${g.id}/members/me/sports-profile`, { headers: auth(g.members[0]) }));
  expect(saved).toMatchObject({ primaryPosition: 'MIDFIELDER', secondaryPosition: 'ATTACKER', canPlayGoalkeeper: true, dominantFoot: 'LEFT' });
});

test('[UI-P02] membros consultam níveis sem controles de edição', async ({ ui, request }) => {
  const g = await group(request, 1);
  const actor = g.members[0];
  await profile(request, g.id, actor);
  await body(await request.put(`/api/groups/${g.id}/members/${actor.membershipId}/technical-profile`, { headers: auth(g.owner), data: { ratings: ratings(8) } }));
  await ui.login(actor);
  await ui.open('technical-profile', { groupId: g.id });
  await ui.screen('technical-profile', 'OVERALL GERAL');
  await ui.sees('Cobertura: 100%');
  await ui.sees('Habilidades');
  await ui.absent('Aumentar Passe em meia estrela');
  await ui.absent('Salvar avaliação');
  expect((await body(await request.get(`/api/groups/${g.id}/members/me/technical-profile`, { headers: auth(actor) }))).ratings).toEqual(ratings(8));
});

test('[UI-P03] administrador avalia habilidades e salva no grupo correto', async ({ ui, request }) => {
  const g = await group(request, 1);
  await profile(request, g.id, g.members[0]);
  await ui.login(g.owner);
  await ui.open('technical-profile', { groupId: g.id, membershipId: g.members[0].membershipId! });
  await ui.sees('Habilidades');
  await ui.tap('Aumentar Passe em meia estrela');
  await ui.tap('Salvar avaliação');
  await ui.sees('Avaliação técnica atualizada.', true);
  const saved = await body(await request.get(`/api/groups/${g.id}/members/${g.members[0].membershipId}/technical-profile`, { headers: auth(g.owner) }));
  expect(saved.ratings.PASSING).toBe(1);
});

test('[UI-P04] perfil incompleto impede salvar sem posição', async ({ ui, request }) => {
  const g = await incompleteGroup(request, 0);
  await ui.login(g.owner);
  await ui.open('sports-profile', { groupId: g.id });
  await ui.tap('Salvar perfil esportivo');
  await ui.sees('Escolha sua posição principal.');
  const saved = await body(await request.get(`/api/groups/${g.id}/members/me/sports-profile`, { headers: auth(g.owner) }));
  expect(saved.primaryPosition).toBeNull();
});
