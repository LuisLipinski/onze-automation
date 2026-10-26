import { readFileSync } from 'node:fs';
import { test, expect } from '../support/test';

test('Spring registers exactly the 95 product operations with test tools disabled', async ({ control }) => {
  const inventory = JSON.parse(readFileSync('coverage/backend-endpoints.json', 'utf8')) as { id: string; optional: boolean }[];
  const actual = await control.call('/routes');
  expect(actual).toHaveLength(95);
  expect(actual).toEqual(inventory.filter(e => !e.optional).map(e => e.id).sort());
});
