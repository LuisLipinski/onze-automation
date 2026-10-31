import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { backendRoutes } from './backend-routes.mjs';

const api = resolve(process.env.ONZE_API_DIR ?? '../onze-api');
const actual = backendRoutes(api);
const expected = JSON.parse(readFileSync('coverage/backend-endpoints.json', 'utf8'));
const changed = actual.filter(a => !expected.some(e => JSON.stringify(e) === JSON.stringify(a)));
const removed = expected.filter(e => !actual.some(a => a.id === e.id));
if (changed.length || removed.length) throw new Error(`Backend contract changed; add scenarios and update the inventory: ${JSON.stringify({ changed, removed })}`);
mkdirSync('.runtime', { recursive: true });
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: api, encoding: 'utf8' }).trim();
writeFileSync('.runtime/backend-source.json', JSON.stringify({ repository: 'LuisLipinski/onze-api', sha, operations: actual.length }, null, 2));
console.log(`Backend ${sha}: ${actual.length} declared HTTP operations match the coverage inventory.`);
