import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { HttpObservation } from './test';

type Endpoint = { id: string; method: string; path: string; authentication: boolean; optional: boolean };
export default class CoverageReporter implements Reporter {
  private observations: (HttpObservation & { scenario: string })[] = [];
  private scenarios: { title: string; status: string }[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    const scenario = test.titlePath().join(' / ');
    this.scenarios.push({ title: scenario, status: result.status });
    if (result.status !== 'passed') return;
    for (const attachment of result.attachments.filter(a => a.name === 'http-coverage' && a.body)) {
      this.observations.push(...JSON.parse(attachment.body!.toString()).map((o: HttpObservation) => ({ ...o, scenario })));
    }
  }
  async onEnd(result: FullResult) {
    const endpoints: Endpoint[] = JSON.parse(readFileSync('coverage/backend-endpoints.json', 'utf8'));
    const matchers = [...endpoints].sort((a, b) => b.path.replace(/\{[^}]+\}/g, '').length - a.path.replace(/\{[^}]+\}/g, '').length).map(e => ({ ...e, pattern: new RegExp('^' + e.path.replace(/\{[^}]+\}/g, '[^/]+') + '$') }));
    const coverage = endpoints.map(endpoint => {
      const calls = this.observations.filter(o => matchers.find(m => m.method === o.method && m.pattern.test(o.path))?.id === endpoint.id);
      return { ...endpoint, positive: calls.some(o => o.status >= 200 && o.status < 300), unauthorized: calls.some(o => o.status === 401), scenarios: [...new Set(calls.map(o => o.scenario))], statuses: [...new Set(calls.map(o => o.status))].sort() };
    });
    const missing = coverage.filter(e => !e.positive || e.authentication && !e.unauthorized);
    mkdirSync('coverage/results', { recursive: true });
    const backend = existsSync('.runtime/backend-source.json') ? JSON.parse(readFileSync('.runtime/backend-source.json', 'utf8')) : null;
    const summary = { generatedAt: new Date().toISOString(), backend, result: result.status, total: coverage.length, positive: coverage.filter(e => e.positive).length, authentication: coverage.filter(e => e.authentication).length, unauthorized: coverage.filter(e => e.authentication && e.unauthorized).length, scenarios: this.scenarios, endpoints: coverage };
    writeFileSync('coverage/results/backend-coverage.json', JSON.stringify(summary, null, 2));
    writeFileSync('coverage/results/backend-coverage.md', '# Backend HTTP coverage\n\n' + `${summary.positive}/${summary.total} operations with successful scenarios; ${summary.unauthorized}/${summary.authentication} protected operations reject anonymous requests.\n\n` + '| Operation | Positive | Anonymous rejected |\n|---|---|---|\n' + coverage.map(e => `| ${e.id} | ${e.positive ? 'PASS' : 'MISSING'} | ${!e.authentication ? 'PUBLIC' : e.unauthorized ? 'PASS' : 'MISSING'} |`).join('\n') + '\n');
    console.log(`Backend HTTP coverage: ${summary.positive}/${summary.total}; authentication ${summary.unauthorized}/${summary.authentication}`);
    if (process.env.BACKEND_COVERAGE_GATE === 'true' && (missing.length || this.scenarios.some(s => s.status !== 'passed'))) {
      console.error('Coverage gate failed:', missing.map(e => e.id));
      return { status: 'failed' as const };
    }
  }
}
