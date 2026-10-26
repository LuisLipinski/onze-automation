import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { resolve, delimiter } from 'node:path';

const api = resolve(process.env.ONZE_API_DIR ?? '../onze-api');
const runtime = resolve('.runtime');
mkdirSync(runtime, { recursive: true });
const run = (command, args, cwd = api) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
};
run('mvn', ['-B', '-q', '-Dmaven.test.skip=true', 'compile', 'dependency:build-classpath', '-Dmdep.outputFile=target/automation-classpath.txt']);
const classpath = [resolve(api, 'target/classes'), readFileSync(resolve(api, 'target/automation-classpath.txt'), 'utf8').trim()].join(delimiter);
const classes = resolve(runtime, 'classes');
mkdirSync(classes, { recursive: true });
run('javac', ['-cp', classpath, '-d', classes, resolve('harness/AutomationApplication.java')], process.cwd());
const children = [];
for (const tools of [false, true]) {
  const port = tools ? 8081 : 8080;
  const controlPort = tools ? 8091 : 8090;
  const database = tools ? 'onze_automation_tools' : 'onze_automation';
  const env = {
    ...process.env,
    ONZE_AUTOMATION_RUNTIME: '1',
    AUTOMATION_CONTROL_PORT: String(controlPort),
    DATABASE_URL: `jdbc:postgresql://127.0.0.1:${tools ? process.env.AUTOMATION_TOOLS_POSTGRES_PORT ?? process.env.AUTOMATION_POSTGRES_PORT ?? '5432' : process.env.AUTOMATION_POSTGRES_PORT ?? '5432'}/${database}`,
    DATABASE_USERNAME: process.env.AUTOMATION_DATABASE_USER ?? 'onze',
    DATABASE_PASSWORD: process.env.AUTOMATION_DATABASE_PASSWORD ?? 'onze-automation-only',
    JWT_SECRET: 'automation-only-key-never-used-in-deployment-0123456789',
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    EXPO_PUSH_ENABLED: 'true',
    EXPO_PUSH_ENDPOINT: `http://127.0.0.1:${controlPort}/expo`,
    MATCH_PROCESSING_DELAY_MS: '86400000',
    MATCH_PROCESSING_INITIAL_DELAY_MS: '86400000',
    RESEND_API_KEY: '', RESEND_FROM: '', CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '',
  };
  if (!env.AUTOMATION_CONTROL_TOKEN || env.AUTOMATION_CONTROL_TOKEN.length < 24) throw new Error('Set AUTOMATION_CONTROL_TOKEN (24+ characters)');
  const args = ['-Xmx384m', '-cp', [classes, classpath].join(delimiter), 'com.onze.automation.AutomationApplication',
    '--server.address=127.0.0.1', `--server.port=${port}`, '--spring.main.banner-mode=off',
    '--logging.level.root=WARN'];
  // The production-like instance exercises the real default (no flag supplied).
  delete env.ONZE_TEST_DATA_ENABLED;
  if (tools) env.ONZE_TEST_DATA_ENABLED = 'true';
  const log = openSync(resolve(runtime, `backend-${port}.log`), 'w');
  const child = spawn('java', args, { env, stdio: ['ignore', log, log] });
  children.push(child);
  child.on('exit', code => { if (code && !process.exitCode) { console.error(`Backend ${port} exited ${code}`); process.exitCode = code; } });
}
writeFileSync(resolve(runtime, 'backend-processes.json'), JSON.stringify(children.map(c => c.pid)));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { for (const child of children) child.kill('SIGTERM'); process.exit(); });
await Promise.all(children.map(child => new Promise(resolve => child.on('exit', resolve))));
