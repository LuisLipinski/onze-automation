import { expect, type TestInfo } from '@playwright/test';
import { type Actor, password } from '../../tests/support/factory';

const appPackage = 'com.onze.organizadordepelada';
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
type Element = Record<typeof elementKey, string>;
type Evidence = { native: true; commands: number; assertions: number; screens: string[] };

function literal(value: string) {
  if (!value.includes("'")) return `'${value}'`;
  return `concat(${value.split("'").map(part => `'${part}'`).join(',"\'",')})`;
}

/** Small W3C client, deliberately restricted to the local Appium server. */
export class Android {
  private session = '';
  private evidence: Evidence = { native: true, commands: 0, assertions: 0, screens: [] };
  private readonly server = 'http://127.0.0.1:4723';

  async command(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST'): Promise<any> {
    const response = await fetch(this.server + path, {
      method, headers: { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json() as any;
    if (!response.ok || payload.value?.error) throw new Error(`Appium ${path}: ${JSON.stringify(payload.value)}`);
    return payload.value;
  }
  private path(suffix: string) { return `/session/${this.session}${suffix}`; }
  async execute(script: string, args: Record<string, unknown> = {}) {
    this.evidence.commands++;
    return this.command(this.path('/execute/sync'), { script, args: [args] });
  }
  async start() {
    const apk = process.env.FRONTEND_APK;
    if (!apk) throw new Error('FRONTEND_APK must identify the isolated emulator APK');
    const value = await this.command('/session', { capabilities: { alwaysMatch: {
      platformName: 'Android', 'appium:automationName': 'UiAutomator2',
      'appium:app': apk, 'appium:appPackage': appPackage,
      'appium:appActivity': '.MainActivity', 'appium:noReset': true,
      'appium:autoGrantPermissions': true, 'appium:newCommandTimeout': 240,
      'appium:adbExecTimeout': 60_000, 'appium:uiautomator2ServerInstallTimeout': 90_000,
      'appium:disableWindowAnimation': true,
    } } });
    this.session = value.sessionId;
    await this.command(this.path('/appium/settings'), { settings: { waitForIdleTimeout: 0, waitForSelectorTimeout: 0 } });
  }
  async stop() { if (this.session) await this.command(this.path(''), undefined, 'DELETE'); }
  async reset() {
    await this.execute('mobile: terminateApp', { appId: appPackage });
    await this.execute('mobile: clearApp', { appId: appPackage });
    await this.execute('mobile: activateApp', { appId: appPackage });
    this.evidence = { native: true, commands: 0, assertions: 0, screens: [] };
    await this.has('E-mail');
  }
  async open(route: string, params: Record<string, string> = {}) {
    const url = `onze://${route.replace(/^\//, '')}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
    await this.execute('mobile: deepLink', { url, package: appPackage, waitForLaunch: true });
  }
  private selector(text: string, contains = false) {
    return contains
      ? `//*[contains(@text,${literal(text)}) or contains(@content-desc,${literal(text)})]`
      : `//*[@text=${literal(text)} or @content-desc=${literal(text)}]`;
  }
  async elements(selector: string): Promise<Element[]> {
    return this.command(this.path('/elements'), { using: 'xpath', value: selector });
  }
  async find(text: string, contains = false) {
    const byDescription = contains ? `//*[contains(@content-desc,${literal(text)})]` : `//*[@content-desc=${literal(text)}]`;
    return (await this.elements(byDescription))[0] ?? (await this.elements(this.selector(text, contains)))[0];
  }
  async scroll(direction: 'up' | 'down' = 'down') {
    return this.execute('mobile: scrollGesture', { left: 50, top: 200, width: 950, height: 1700, direction, percent: 0.75 });
  }
  async seek(text: string, contains = false): Promise<Element> {
    // Allow asynchronous requests/navigation to settle before moving the screen.
    for (let i = 0; i < 8; i++) {
      const element = await this.find(text, contains);
      if (element) return element;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    for (const direction of ['down', 'up', 'down'] as const) {
      for (let i = 0; i < 13; i++) {
        const more = await this.scroll(direction);
        const element = await this.find(text, contains);
        if (element) return element;
        if (!more) break;
      }
    }
    throw new Error(`Android element not found: ${text}`);
  }
  async tap(text: string, contains = false) {
    const element = await this.seek(text, contains);
    this.evidence.commands++;
    await this.command(this.path(`/element/${element[elementKey]}/click`), {});
  }
  async fill(placeholder: string, value: string) {
    const element = await this.seek(placeholder);
    await this.fillElement(element, value);
  }
  async fillByLabel(prefix: string, value: string) {
    const element = await this.seek(prefix, true);
    await this.fillElement(element, value);
  }
  private async fillElement(element: Element, value: string) {
    const id = element[elementKey];
    await this.command(this.path(`/element/${id}/clear`), {});
    this.evidence.commands++;
    await this.command(this.path(`/element/${id}/value`), { text: value });
    await this.execute('mobile: hideKeyboard').catch(() => undefined);
  }
  async has(text: string, contains = false) {
    this.evidence.assertions++;
    await expect.poll(async () => Boolean(await this.find(text, contains)), { message: `Android shows ${text}`, timeout: 20_000 }).toBe(true);
  }
  async sees(text: string, contains = false) {
    this.evidence.assertions++;
    expect(await this.seek(text, contains)).toBeTruthy();
  }
  async absent(text: string, contains = false) {
    this.evidence.assertions++;
    expect(await this.find(text, contains), `Android must hide ${text}`).toBeUndefined();
  }
  async screen(route: string, sentinel: string, contains = false) {
    await this.sees(sentinel, contains);
    this.evidence.screens.push(route);
  }
  async disabled(text: string) {
    await this.seek(text);
    const matches = await this.elements(`//*[@enabled='false' and (@text=${literal(text)} or @content-desc=${literal(text)} or .//*[@text=${literal(text)} or @content-desc=${literal(text)}])]`);
    this.evidence.assertions++;
    expect(matches.length, `${text} must be disabled on Android`).toBeGreaterThan(0);
  }
  async signIn(actor: Actor) {
    await this.fill('E-mail', actor.user.email);
    await this.fill('Senha', password);
    await this.tap('Entrar');
  }
  async login(actor: Actor) {
    await this.signIn(actor);
    await this.has(`Olá, ${actor.user.displayName}`);
  }
  async tabs() {
    for (const label of ['Home', 'Grupos', 'Configurações']) await this.has(label);
  }
  async back() { await this.execute('mobile: pressKey', { keycode: 4 }); }
  async attach(info: TestInfo) {
    await info.attach('android-evidence', { body: JSON.stringify(this.evidence), contentType: 'application/json' });
    if (this.session) {
      const screenshot = await this.command(this.path('/screenshot')).catch(() => null);
      if (screenshot) await info.attach('android-screen', { body: Buffer.from(screenshot, 'base64'), contentType: 'image/png' });
      if (info.status !== info.expectedStatus) {
        const xml = await this.command(this.path('/source')).catch(String);
        await info.attach('android-hierarchy', { body: xml, contentType: 'application/xml' });
      }
    }
  }
}
