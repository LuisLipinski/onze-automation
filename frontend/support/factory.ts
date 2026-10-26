import type { APIRequestContext } from '@playwright/test';
import { group as apiGroup, profile } from '../../tests/support/factory';

export * from '../../tests/support/factory';
export { apiGroup as incompleteGroup };

// The mobile group entrance requires a complete sports profile. Prepare this
// prerequisite through the real API; tests of onboarding use incompleteGroup.
export async function group(request: APIRequestContext, members = 2) {
  const value = await apiGroup(request, members);
  for (const actor of value.actors) await profile(request, value.id, actor);
  return value;
}
