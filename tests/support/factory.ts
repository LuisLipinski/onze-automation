import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type APIResponse } from '@playwright/test';
import { expect, type Control } from './test';

export type Actor = { accessToken: string; user: { id: string; email: string; displayName: string }; membershipId?: string };
export const password = 'OnzeTest123!';
export const auth = (actor: Actor) => ({ Authorization: `Bearer ${actor.accessToken}` });
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=', 'base64');
export const skills = ['PASSING','LONG_PASSING','CROSSING','BALL_CONTROL','DRIBBLING','FINISHING','SPEED','AGILITY','STRENGTH','HEADING','TACKLING','DEFENSIVE_POSITIONING','ATTACKING_POSITIONING','VISION','GOALKEEPER_REFLEXES','GOALKEEPER_POSITIONING','GOALKEEPER_RUSHING_OUT'];
export const ratings = (score = 7) => Object.fromEntries(skills.map(s => [s, score]));
export async function body(response: APIResponse, status = 200): Promise<any> {
  expect(response.status(), `${response.url()}: ${await response.text()}`).toBe(status);
  return status === 204 ? undefined : response.json();
}
export async function register(request: APIRequestContext, name = 'Jogador QA'): Promise<Actor> {
  return body(await request.post('/api/auth/register', { data: { email: `${randomUUID()}@onze.test`, password, displayName: name } }), 201);
}
export async function group(request: APIRequestContext, members = 2) {
  const actors: Actor[] = [];
  for (let i = 0; i <= members; i++) actors.push(await register(request, `Jogador ${i}`));
  const [owner] = actors;
  const value = await body(await request.post('/api/groups', { headers: auth(owner), data: { name: 'Grupo automação', description: 'Ambiente descartável' } }), 201);
  const invitation = await body(await request.post(`/api/groups/${value.id}/invite`, { headers: auth(owner) }));
  for (const actor of actors.slice(1)) await body(await request.post('/api/groups/join', { headers: auth(actor), data: { code: invitation.code } }));
  const memberships = await body(await request.get(`/api/groups/${value.id}/members`, { headers: auth(owner) }));
  for (const actor of actors) actor.membershipId = memberships.find((m: any) => m.userId === actor.user.id).membershipId;
  return { id: value.id as string, owner, actors, invitation, members: actors.slice(1), value };
}
export async function profile(request: APIRequestContext, groupId: string, actor: Actor, primaryPosition = 'MIDFIELDER', secondaryPosition: string | null = null, canPlayGoalkeeper = false) {
  return body(await request.put(`/api/groups/${groupId}/members/me/sports-profile`, { headers: auth(actor), data: { primaryPosition, secondaryPosition, canPlayGoalkeeper, dominantFoot: 'RIGHT' } }));
}
export function dateTime(iso: string) { return { date: iso.slice(0, 10), time: iso.slice(11, 19) }; }
export async function matchData(control: Control, overrides: Record<string, unknown> = {}) {
  const now = Date.parse(await control.now());
  const starts = dateTime(new Date(now + 3 * 86400000).toISOString());
  const signup = dateTime(new Date(now + 86400000).toISOString());
  const payment = dateTime(new Date(now + 2 * 86400000).toISOString());
  return { date: starts.date, startTime: starts.time, timeZone: 'UTC', venue: 'Arena QA', maxPlayers: 8, matchType: 'INTERNAL', teamCount: 2, requiredGoalkeepers: 2, modality: 'FUTSAL', minimumPlayers: 2, paymentRequired: false, goalkeeperPays: false, recurrence: 'NONE', signupDeadlineDate: signup.date, signupDeadlineTime: signup.time, ...overrides, ...(overrides.paymentRequired ? { paymentDeadlineDate: payment.date, paymentDeadlineTime: payment.time, paymentAmount: 25, pixKey: 'qa@onze.test', ...overrides } : {}) };
}
export async function createMatch(request: APIRequestContext, control: Control, groupId: string, owner: Actor, overrides: Record<string, unknown> = {}) {
  return body(await request.post(`/api/groups/${groupId}/matches`, { headers: auth(owner), data: await matchData(control, overrides) }), 201);
}
export async function going(request: APIRequestContext, matchId: string, actor: Actor, status = 'GOING') {
  return body(await request.put(`/api/matches/${matchId}/attendance`, { headers: auth(actor), data: { status } }));
}
export async function getMatch(request: APIRequestContext, matchId: string, actor: Actor) {
  return body(await request.get(`/api/matches/${matchId}`, { headers: auth(actor) }));
}
export async function promote(request: APIRequestContext, groupId: string, owner: Actor, actor: Actor, permissions: string[] = []) {
  await body(await request.put(`/api/groups/${groupId}/members/${actor.membershipId}/promote`, { headers: auth(owner) }));
  await body(await request.put(`/api/groups/${groupId}/members/${actor.membershipId}/permissions`, { headers: auth(owner), data: { permissions } }));
}
export async function preparedMatch(request: APIRequestContext, control: Control, overrides: Record<string, unknown> = {}) {
  const g = await group(request, 3);
  for (let i = 0; i < g.actors.length; i++) await profile(request, g.id, g.actors[i], i < 2 ? 'GOALKEEPER' : 'MIDFIELDER');
  const match = await createMatch(request, control, g.id, g.owner, { maxPlayers: 6, ...overrides });
  for (const actor of g.actors) await going(request, match.id, actor);
  return { ...g, match };
}
export async function generatedMatch(request: APIRequestContext, control: Control, overrides: Record<string, unknown> = {}) {
  const g = await preparedMatch(request, control, overrides);
  const teams = await body(await request.post(`/api/matches/${g.match.id}/teams/generate`, { headers: auth(g.owner) }));
  return { ...g, teams, assignments: teams.teams.flatMap((t: any) => t.assignments.map((a: any) => ({ ...a, teamNumber: t.teamNumber }))) as any[] };
}
export async function liveMatch(request: APIRequestContext, control: Control, overrides: Record<string, unknown> = {}) {
  const g = await generatedMatch(request, control, overrides);
  await body(await request.put(`/api/matches/${g.match.id}/live/start`, { headers: auth(g.owner), data: { teams: [{ teamNumber: 1, name: 'Preto' }, { teamNumber: 2, name: 'Branco' }] } }));
  return g;
}
export async function live(request: APIRequestContext, matchId: string, actor: Actor) {
  return body(await request.get(`/api/matches/${matchId}/live`, { headers: auth(actor) }));
}
