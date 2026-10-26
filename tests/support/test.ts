import { test as base, expect, type APIRequestContext } from '@playwright/test';

export type HttpObservation = { method: string; path: string; status: number };
export class Control {
  constructor(private url: string) {}
  async call<T = any>(path: string, data?: unknown): Promise<T> {
    const token = process.env.AUTOMATION_CONTROL_TOKEN;
    if (!token) throw new Error('AUTOMATION_CONTROL_TOKEN is required for the isolated runtime');
    const response = await fetch(this.url + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'X-Automation-Token': token, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`Control ${path}: ${JSON.stringify(result)}`);
    return result as T;
  }
  async now(): Promise<string> { return (await this.call('/clock')).now; }
  async at(instant: string): Promise<void> { await this.call('/clock', { instant }); }
  async advance(ms: number): Promise<void> { await this.at(new Date(Date.parse(await this.now()) + ms).toISOString()); }
  async process(): Promise<void> { await this.call('/process', {}); }
}

export const test = base.extend<{ control: Control; isolation: void; observations: HttpObservation[] }>({
  observations: async ({}, use, info) => {
    const observations: HttpObservation[] = [];
    await use(observations);
    await info.attach('http-coverage', { body: JSON.stringify(observations), contentType: 'application/json' });
  },
  control: async ({ baseURL }, use, info) => {
    const target = new URL(baseURL!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('The full suite may only target the disposable loopback runtime');
    await use(new Control(info.project.metadata.controlURL as string));
  },
  isolation: [async ({ control }, use) => {
    await control.call('/reset', {});
    await use();
  }, { auto: true }],
  request: async ({ request, observations, baseURL }, use) => {
    const methods = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'fetch']);
    const wrapped = new Proxy(request, {
      get(target, prop) {
        if (typeof prop === 'string' && methods.has(prop)) return async (url: string, options?: any) => {
          if (new URL(String(url), baseURL).origin !== new URL(baseURL!).origin) throw new Error('Requests outside the isolated API are forbidden');
          const response = await (target[prop as keyof APIRequestContext] as any).call(target, url, options);
          observations.push({ method: prop === 'fetch' ? (options?.method ?? 'GET').toUpperCase() : prop.toUpperCase(), path: new URL(String(url), 'http://localhost').pathname, status: response.status() });
          return response;
        };
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await use(wrapped);
  },
});
export { expect };

export type { APIRequestContext } from '@playwright/test';
