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
      'appium:showLogcat': true,
      'appium:logcatFilterSpecs': ['ReactNativeJS:W', 'AndroidRuntime:E', '*:S'],
    } } });
    this.session = value.sessionId;
    await this.command(this.path('/appium/settings'), { settings: { waitForIdleTimeout: 500, waitForSelectorTimeout: 0 } });
  }
  async stop() { if (this.session) await this.command(this.path(''), undefined, 'DELETE'); }
  async reset(beginTest = false) {
    if (beginTest) this.evidence = { native: true, commands: 0, assertions: 0, screens: [] };
    await this.execute('mobile: terminateApp', { appId: appPackage });
    await this.execute('mobile: clearApp', { appId: appPackage });
    await this.execute('mobile: activateApp', { appId: appPackage });
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
    await this.dismissNotificationPermission();
    const byDescription = contains ? `//*[contains(@content-desc,${literal(text)})]` : `//*[@content-desc=${literal(text)}]`;
    return (await this.elements(byDescription))[0] ?? (await this.elements(this.selector(text, contains)))[0];
  }
  private async dismissNotificationPermission() {
    const notificationRequest = await this.elements(`//*[@resource-id='com.android.permissioncontroller:id/permission_message' and contains(@text,'Onze') and contains(@text,'notifications')]`);
    if (!notificationRequest.length) return;
    // Exercise the OS denial path, keeping the emulator independent of real
    // Expo/FCM registration. Push delivery remains in the backend boundary suite.
    const buttons = await this.elements(`//*[starts-with(@resource-id,'com.android.permissioncontroller:id/permission_deny') and @clickable='true']`);
    if (buttons[0]) {
      this.evidence.assertions++;
      await this.click(buttons[0]);
    }
  }
  async scroll(direction: 'up' | 'down' = 'down') {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const containers = await this.elements(`//*[@scrollable='true']`);
        const box = containers.length
          ? await this.command(this.path(`/element/${containers.at(-1)![elementKey]}/rect`))
          : { x: 40, y: 190, width: 970, height: 1720 };
        // Use the live viewport bounds. Passing a cached UiObject2 to Android's
        // scroll implementation becomes stale during React layout updates.
        if (!containers.length) return false;
        await this.execute('mobile: swipeGesture', {
          left: box.x + 10, top: box.y + 10,
          width: Math.max(1, box.width - 20), height: Math.max(1, box.height - 20), direction, percent: 0.7, speed: 3000,
        });
        return true;
      } catch (error) {
        if (attempt || !(error instanceof Error) || !error.message.includes('stale element reference')) throw error;
      }
    }
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
    let element = await this.seek(text, contains);
    const condition = contains
      ? `contains(@text,${literal(text)}) or contains(@content-desc,${literal(text)})`
      : `@text=${literal(text)} or @content-desc=${literal(text)}`;
    // Labels can occur both in headings and in buttons. Prefer the actual
    // Android action node; a Switch must be tapped rather than its static label.
    const clickable = await this.elements(`//*[(${condition}) and @clickable='true']`);
    if (clickable[0]) element = clickable[0];
    else {
      const parents = await this.elements(`//*[${condition}]/ancestor::*[@clickable='true'][1]`);
      if (parents[0]) element = parents[0];
    }
    try { await this.click(element); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('stale element reference')) throw error;
      // Stale means Android rejected the input before performing it. Re-query
      // only this stale handle; never repeat a timed-out or successful action.
      await this.click(await this.seek(text, contains));
    }
  }
  private async click(element: Element) {
    // Gesture taps are reliable for React Native dialog controls where a
    // UiObject2 click can return successfully without dispatching the press.
    await this.execute('mobile: clickGesture', { elementId: element[elementKey] });
  }
  async tapLast(text: string) {
    await this.seek(text);
    const matches = await this.elements(this.selector(text));
    await this.click(matches.at(-1)!);
  }
  async fill(placeholder: string, value: string) {
    await this.fillMatching(placeholder, value, false);
  }
  async fillByLabel(prefix: string, value: string) {
    await this.fillMatching(prefix, value, true);
  }
  private async fillMatching(label: string, value: string, contains: boolean) {
    const original = await this.seek(label, contains);
    const inputs = await this.elements('//android.widget.EditText');
    const index = inputs.findIndex(element => element[elementKey] === original[elementKey]);
    expect(index, `Editable Android input ${label}`).toBeGreaterThanOrEqual(0);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const element = (await this.elements('//android.widget.EditText'))[index];
        await this.command(this.path(`/element/${element[elementKey]}/clear`), {});
        const fresh = (await this.elements('//android.widget.EditText'))[index];
        this.evidence.commands++;
        await this.command(this.path(`/element/${fresh[elementKey]}/value`), { text: value });
        break;
      } catch (error) {
        if (attempt === 2 || !(error instanceof Error) || !error.message.includes('stale element reference')) throw error;
      }
    }
    await this.execute('mobile: hideKeyboard').catch(() => undefined);
  }
  async has(text: string, contains = false, timeout = 20_000) {
    this.evidence.assertions++;
    await expect.poll(async () => Boolean(await this.find(text, contains)), { message: `Android shows ${text}`, timeout }).toBe(true);
  }
  async sees(text: string, contains = false) {
    this.evidence.assertions++;
    expect(await this.seek(text, contains)).toBeTruthy();
  }
  async absent(text: string, contains = false) {
    this.evidence.assertions++;
    await expect.poll(async () => this.find(text, contains), { message: `Android must hide ${text}` }).toBeUndefined();
  }
  async screen(route: string, sentinel: string, contains = false) {
    await this.sees(sentinel, contains);
    this.evidence.screens.push(route);
  }
  async disabled(text: string) {
    await this.seek(text);
    this.evidence.assertions++;
    await expect.poll(async () => (await this.elements(`//*[@enabled='false' and (@text=${literal(text)} or @content-desc=${literal(text)} or .//*[@text=${literal(text)} or @content-desc=${literal(text)}])]`)).length, { message: `${text} must be disabled on Android` }).toBeGreaterThan(0);
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
  async shareSheet() {
    this.evidence.assertions++;
    await expect.poll(async () => this.execute('mobile: getCurrentPackage')).toMatch(/^(android|com\.android\.intentresolver|com\.google\.android\.)/);
  }
  async tapWithin(label: string, action: string) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const labels = await this.elements(`//*[@text=${literal(label)}]`);
      const actions = await this.elements(`//*[@content-desc=${literal(action)} and @clickable='true']`);
      for (const name of labels) {
        const nr = await this.command(this.path(`/element/${name[elementKey]}/rect`));
        for (const candidate of actions) {
          const ar = await this.command(this.path(`/element/${candidate[elementKey]}/rect`));
          if (Math.abs(ar.y + ar.height / 2 - nr.y - nr.height / 2) < 60 && ar.x > nr.x + nr.width) {
            await this.click(candidate); return;
          }
        }
      }
      if (!await this.scroll('down')) break;
    }
    throw new Error(`${action} in Android row ${label} not found`);
  }
  async back() { await this.execute('mobile: pressKey', { keycode: 4 }); }
  async tapId(id: string) {
    const element = (await this.elements(`//*[@resource-id=${literal(id)}]`))[0];
    expect(element, `Android resource ${id}`).toBeTruthy();
    await this.click(element);
  }
  async hasId(id: string) {
    this.evidence.assertions++;
    await expect.poll(async () => (await this.elements(`//*[@resource-id=${literal(id)}]`)).length).toBeGreaterThan(0);
  }
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
