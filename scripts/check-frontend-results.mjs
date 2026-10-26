import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const catalog = JSON.parse(readFileSync('coverage/frontend-flows.json', 'utf8'));
function reports(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? reports(resolve(dir, entry.name)) : /^frontend-shard-.*\.json$/.test(entry.name) ? [resolve(dir, entry.name)] : []);
}
const runs = reports('.runtime/android-shards').map(path => JSON.parse(readFileSync(path, 'utf8')));
if (runs.length !== 4) throw new Error(`Expected all four Android shards, got ${runs.length}`);
const cases = runs.flatMap(run => run.cases);
const valid = cases.filter(test => test.status === 'passed' && test.evidence?.native && test.evidence.assertions > 0 && test.evidence.commands > 0);
const covered = new Set(valid.map(test => test.id));
const screens = new Set(valid.flatMap(test => test.evidence.screens));
const missing = catalog.flows.filter(flow => !covered.has(flow.id));
const missingRoutes = catalog.routes.filter(route => !screens.has(route));
if (runs.some(run => !/^[a-f0-9]{40}$/.test(run.backend.sha) || !/^[a-f0-9]{40}$/.test(run.mobile.revision))) throw new Error('Missing exact API/mobile source revision');
const backendRevisions = new Set(runs.map(run => run.backend.sha));
const mobileRevisions = new Set(runs.map(run => run.mobile.revision));
if (backendRevisions.size !== 1 || mobileRevisions.size !== 1) throw new Error('Shards exercised different source revisions');
if (cases.length !== catalog.flows.length || new Set(cases.map(test => test.id)).size !== cases.length || valid.length !== cases.length || missing.length || missingRoutes.length) {
  throw new Error(JSON.stringify({ expected: catalog.flows.length, executed: cases.length, passedWithNativeEvidence: valid.length, missing: missing.map(test => test.id), missingRoutes }, null, 2));
}
const result = { flows: `${covered.size}/${catalog.flows.length}`, routes: `${screens.size}/${catalog.routes.length}`, backend: runs[0].backend, mobile: runs[0].mobile, assertions: valid.reduce((n, test) => n + test.evidence.assertions, 0), cases };
mkdirSync('coverage/results', { recursive: true });
writeFileSync('coverage/results/frontend-coverage.json', JSON.stringify(result, null, 2));
writeFileSync('coverage/results/frontend-coverage.md', `# Android UI coverage\n\n${result.flows} declared functional scenarios passed; ${result.routes} route entry/guard assertions; ${result.assertions} native UI assertions.\n\nThis measures the declared functional matrix, not source lines, pixels or all data/device combinations. API fixtures are setup only. Provider delivery, physical biometrics, camera/gallery editing and WhatsApp delivery require separate device/provider validation.\n\n| Flow | Result |\n|---|---|\n${cases.map(test => `| ${test.title} | ${test.status} |`).join('\n')}\n`);
console.log(`${result.flows} native Android flows; ${result.routes} route assertions; ${result.assertions} UI assertions; zero failures/skips`);
