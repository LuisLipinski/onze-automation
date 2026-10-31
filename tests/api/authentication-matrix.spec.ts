import { readFileSync } from 'node:fs';
import { test, expect } from '../support/test';

const endpoints = JSON.parse(readFileSync('coverage/backend-endpoints.json', 'utf8')) as { id: string; method: string; path: string; authentication: boolean }[];
for (const endpoint of endpoints.filter(e => e.authentication)) {
  test(`anonymous request rejected: ${endpoint.id}`, async ({ request }) => {
    const path = endpoint.path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000001');
    const response = await request.fetch(path, { method: endpoint.method, data: {} });
    expect(response.status()).toBe(401);
  });
}
