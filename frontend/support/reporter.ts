import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export default class AndroidReporter implements Reporter {
  private cases: any[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    const evidence = result.attachments.find(item => item.name === 'android-evidence');
    this.cases.push({
      id: /\[(UI-[A-Z]\d+)\]/.exec(test.title)?.[1], title: test.title,
      status: result.status, duration: result.duration,
      evidence: evidence?.body ? JSON.parse(evidence.body.toString()) : null,
    });
  }
  onEnd() {
    mkdirSync('coverage/results', { recursive: true });
    const source = (name: string) => JSON.parse(readFileSync(`.runtime/${name}-source.json`, 'utf8'));
    writeFileSync(`coverage/results/frontend-shard-${process.env.FRONTEND_SHARD ?? 'local'}.json`, JSON.stringify({
      backend: source('backend'), mobile: source('mobile'), cases: this.cases,
    }, null, 2));
  }
}
