import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const mobile = resolve(process.env.ONZE_MOBILE_DIR ?? (process.env.CI ? 'mobile-source' : '../onze-mobile'));
const catalog = JSON.parse(readFileSync('coverage/frontend-flows.json', 'utf8'));
function routes(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? routes(resolve(dir, entry.name)) : entry.name.endsWith('.tsx') && entry.name !== '_layout.tsx' ? [relative(resolve(mobile, 'app'), resolve(dir, entry.name)).replace(/\.tsx$/, '')] : []);
}
const actual = routes(resolve(mobile, 'app')).sort();
const declared = [...catalog.routes].sort();
if (JSON.stringify(actual) !== JSON.stringify(declared)) throw new Error(`Frontend route inventory changed. Actual: ${actual.join(', ')}. Update routes and their exercised UI flows.`);
const ids = catalog.flows.map(flow => flow.id);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate frontend flow IDs');
const source = readdirSync('frontend').filter(file => file.endsWith('.spec.ts')).map(file => readFileSync(`frontend/${file}`, 'utf8')).join('\n');
const tests = [...source.matchAll(/test\('\[(UI-[A-Z]\d+)\]/g)].map(match => match[1]);
if (JSON.stringify([...tests].sort()) !== JSON.stringify([...ids].sort())) throw new Error('Frontend catalog and executable scenarios must match exactly');
mkdirSync('.runtime', { recursive: true });
const revision = execFileSync('git', ['-C', mobile, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync('.runtime/mobile-source.json', JSON.stringify({ repository: 'LuisLipinski/onze-mobile', revision, routes: actual }, null, 2));
console.log(`${actual.length} Expo Router routes; ${ids.length} declared native Android flows; mobile ${revision}`);
