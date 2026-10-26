import type { APIRequestContext } from '@playwright/test';
import { auth, body, group as apiGroup, profile, type Actor } from '../../tests/support/factory';

export * from '../../tests/support/factory';
export { apiGroup as incompleteGroup };

export async function readGroup(request: APIRequestContext, id: string, actor: Actor) {
  const groups = await body(await request.get('/api/groups', { headers: auth(actor) }));
  return groups.find((value: any) => value.id === id);
}

// The mobile group entrance requires a complete sports profile. Prepare this
// prerequisite through the real API; tests of onboarding use incompleteGroup.
export async function group(request: APIRequestContext, members = 2) {
  const value = await apiGroup(request, members);
  for (const actor of value.actors) await profile(request, value.id, actor);
  return value;
}
