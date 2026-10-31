import { expect, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { type Actor, password } from '../../tests/support/factory';

const appPackage = 'com.onze.organizadordepelada';
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
type Element = Record<typeof elementKey, string>;
type Evidence = { native: true; commands: number; assertions: number; screens: string[] };
type Rect = { x: number; y: number; width: number; height: number };
export type NotificationPermission = 'granted' | 'prompt' | 'denied';

function literal(value: string) {
  if (!value.includes("'")) return `'${value}'`;
  return `concat(${value.split("'").map(part => `'${part}'`).join(',"\'",')})`;
}

/** Small W3C client, deliberately restricted to the local Appium server. */
export class Android {
  private session = '';
  private viewport: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private beforeScroll = '';
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
    const packaged = JSON.parse(execFileSync('unzip', ['-p', apk, 'assets/app.config'], { encoding: 'utf8' }));
    if ((packaged.expo ?? packaged).extra?.eas?.projectId) {
      throw new Error('FRONTEND_APK must use emulator recipe v2 without a remote EAS project');
    }
    const value = await this.command('/session', { capabilities: { alwaysMatch: {
      platformName: 'Android', 'appium:automationName': 'UiAutomator2',
      'appium:app': apk, 'appium:appPackage': appPackage,
      'appium:appActivity': '.MainActivity', 'appium:noReset': true,
      'appium:autoGrantPermissions': false, 'appium:newCommandTimeout': 240,
      'appium:adbExecTimeout': 60_000, 'appium:uiautomator2ServerInstallTimeout': 90_000,
      'appium:disableWindowAnimation': true,
      'appium:showLogcat': true,
      'appium:logcatFilterSpecs': ['ReactNativeJS:W', 'AndroidRuntime:E', '*:S'],
    } } });
    this.session = value.sessionId;
    await this.command(this.path('/appium/settings'), { settings: {
      waitForIdleTimeout: 500, waitForSelectorTimeout: 0,
      // Include visible app windows and React Native dialogs.
      enableMultiWindows: true,
    } });
    this.viewport = await this.command(this.path('/window/rect'));
  }
  async stop() { if (this.session) await this.command(this.path(''), undefined, 'DELETE'); }
  async reset(beginTest = false, notificationPermission: NotificationPermission = 'granted') {
    if (beginTest) {
      this.evidence = { native: true, commands: 0, assertions: 0, screens: [] };
      this.beforeScroll = '';
    }
    // Close any OS chooser or shade left by a failed test before restarting.
    await this.back();
    await this.execute('mobile: terminateApp', { appId: appPackage });
    await this.execute('mobile: clearApp', { appId: appPackage });
    // Remote push remains isolated in the APK. Permission regressions use the
    // real Android dialog or a previously denied state; other flows grant it.
    const permission = 'android.permission.POST_NOTIFICATIONS';
    execFileSync('adb', ['shell', 'pm', notificationPermission === 'granted' ? 'grant' : 'revoke',
      appPackage, permission], { timeout: 10_000 });
    if (notificationPermission !== 'granted') {
      execFileSync('adb', ['shell', 'pm', notificationPermission === 'prompt' ? 'clear-permission-flags' : 'set-permission-flags',
        appPackage, permission, 'user-set', 'user-fixed'], { timeout: 10_000 });
    }
    await this.execute('mobile: activateApp', { appId: appPackage });
    await this.has('E-mail');
  }
  async open(route: string, params: Record<string, string> = {}) {
    const url = `onze://${route.replace(/^\//, '')}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
    await this.execute('mobile: deepLink', { url, package: appPackage, waitForLaunch: true });
  }
  private condition(text: string, contains = false) {
    return contains
      ? `contains(@text,${literal(text)}) or contains(@content-desc,${literal(text)})`
      : `@text=${literal(text)} or @content-desc=${literal(text)}`;
  }
  private selector(text: string, contains = false) {
    return `//*[@package='${appPackage}' and @displayed='true' and (${this.condition(text, contains)})]`;
  }
  async elements(selector: string): Promise<Element[]> {
    return this.command(this.path('/elements'), { using: 'xpath', value: selector });
  }
  async scrollToText(text: string) {
    // UiScrollable owns the native ScrollView's scrolling sequence. Use it
    // for long Android picker lists nested inside React Native pressables.
    const selector = `new UiScrollable(new UiSelector().packageName(${JSON.stringify(appPackage)}).scrollable(true))`
      + `.setAsVerticalList().setMaxSearchSwipes(16).scrollIntoView(new UiSelector().packageName(${JSON.stringify(appPackage)}).text(${JSON.stringify(text)}))`;
    this.evidence.commands++;
    const matches: Element[] = await this.command(this.path('/elements'), { using: '-android uiautomator', value: selector });
    await this.settle();
    this.evidence.assertions++;
    expect(matches.length, `Android scrolls picker to ${text}`).toBeGreaterThan(0);
  }
  async find(text: string, contains = false, action = false, occurrence: 'first' | 'last' = 'last') {
    const visible = `@package='${appPackage}' and @displayed='true'`;
    if (action) {
      const condition = this.condition(text, contains);
      const direct = await this.elements(`//*[${visible} and @clickable='true' and (${condition})]`);
      if (direct.length) return direct.at(occurrence === 'first' ? 0 : -1);
      const parents = await this.elements(`${this.selector(text, contains)}/ancestor::*[${visible} and @clickable='true'][1]`);
      if (parents.length) return parents.at(occurrence === 'first' ? 0 : -1);
      // Android's clock exposes virtual hour/minute controls as non-clickable
      // accessibility nodes. They still support a physical touch at their bounds.
      return (await this.elements(`${this.selector(text, contains)}[starts-with(@class,'android.widget.RadialTimePickerView$')]`))[0];
    }
    const description = contains ? `contains(@content-desc,${literal(text)})` : `@content-desc=${literal(text)}`;
    const byDescription = `//*[${visible} and ${description}]`;
    return (await this.elements(byDescription))[0] ?? (await this.elements(this.selector(text, contains)))[0];
  }
  async scroll(direction: 'up' | 'down' = 'down') {
    const before: string = await this.command(this.path('/source'));
    if (!before.includes(`package="${appPackage}"`)) throw new Error('Android left Onze before scrolling; inspect native crash log');
    this.beforeScroll = before;
    const containers = [...before.matchAll(/<[^/!?][^>]*\bscrollable="true"[^>]*>/g)]
      .map(match => match[0])
      .filter(tag => tag.includes(`package="${appPackage}"`) && !tag.includes('HorizontalScrollView'));
    const bounds = containers.at(-1)?.match(/\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!bounds) return false;
    const [, left, upper, right, lower] = bounds.map(Number);
    // Start in the scroll view's gutter. Inputs and switches can consume a
    // gesture that begins inside their own bounds, especially on long forms.
    const x = Math.round(left + Math.min(22, (right - left) * 0.04));
    const top = Math.round(upper + (lower - upper) * 0.15);
    const bottom = Math.round(upper + (lower - upper) * 0.85);
    // Use a bounded finger movement instead of a cached scroll-container
    // handle or scrollGesture's unreliable canScrollMore result on RN views.
    await this.touch([
      { type: 'pointerMove', duration: 0, x, y: direction === 'down' ? bottom : top },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 100 },
      { type: 'pointerMove', duration: 500, x, y: direction === 'down' ? top : bottom },
      { type: 'pointerUp', button: 0 },
    ]);
    const after: string = await this.command(this.path('/source'));
    if (!after.includes(`package="${appPackage}"`)) throw new Error('Android left Onze during scrolling; inspect native crash log');
    // Geometry changes when the page moves; live clock text does not count.
    return this.geometry(before) !== this.geometry(after);
  }
  private geometry(source: string) { return source.match(/\bbounds="[^"]*"/g)?.join(); }
  private async settle() {
    // A scroll can keep moving after pointerUp. Cached element rectangles
    // alone do not detect that motion; compare fresh hierarchy snapshots.
    let previous = '';
    let stable = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const source: string = await this.command(this.path('/source'));
      const current = this.geometry(source) ?? '';
      stable = current === previous ? stable + 1 : 0;
      if (stable >= 2) return;
      previous = current;
    }
    throw new Error('Android layout did not settle after native touch');
  }
  async seek(text: string, contains = false, action = false, occurrence: 'first' | 'last' = 'last'): Promise<Element> {
    // Allow asynchronous requests/navigation to settle before moving the screen.
    for (let i = 0; i < 8; i++) {
      const element = await this.find(text, contains, action, occurrence);
      if (element) return element;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    for (const direction of ['down', 'up', 'down'] as const) {
      for (let i = 0; i < 13; i++) {
        const more = await this.scroll(direction);
        const element = await this.find(text, contains, action, occurrence);
        if (element) return element;
        if (!more) break;
      }
    }
    throw new Error(`Android element not found: ${text}`);
  }
  async tap(text: string, contains = false, occurrence: 'first' | 'last' = 'last') {
    // Continue scrolling past a matching heading until its action is visible.
    const element = await this.seek(text, contains, true, occurrence);
    try { await this.click(element); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('stale element reference')) throw error;
      // Stale means Android rejected the input before performing it. Re-query
      // only this stale handle; never repeat a timed-out or successful action.
      await this.click(await this.seek(text, contains, true, occurrence));
    }
  }
  private async click(element: Element) {
    const path = this.path(`/element/${element[elementKey]}/rect`);
    let rect: Rect = await this.command(path);
    // Switches, keyboard dismissal and modals can move the target during a
    // React Native layout pass. Wait for its bounds before sending one touch.
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const next: Rect = await this.command(path);
      if (JSON.stringify(next) === JSON.stringify(rect)) break;
      rect = next;
    }
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    if (rect.width <= 0 || rect.height <= 0 || x < 0 || x >= this.viewport.width || y < 0 || y >= this.viewport.height) {
      throw new Error(`Android action is outside the viewport: ${JSON.stringify(rect)}`);
    }
    // A complete down/up touch also dispatches React Native modal presses.
    await this.touch([
      { type: 'pointerMove', duration: 0, x, y },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 100 },
      { type: 'pointerUp', button: 0 },
    ]);
  }
  private async touch(actions: Record<string, unknown>[]) {
    this.evidence.commands++;
    await this.command(this.path('/actions'), { actions: [{
      type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions,
    }] });
    await this.settle();
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
    const inputSelector = `//android.widget.EditText[@package='${appPackage}' and @displayed='true']`;
    const inputs = await this.elements(inputSelector);
    const index = inputs.findIndex(element => element[elementKey] === original[elementKey]);
    expect(index, `Editable Android input ${label}`).toBeGreaterThanOrEqual(0);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const element = (await this.elements(inputSelector))[index];
        await this.command(this.path(`/element/${element[elementKey]}/clear`), {});
        const fresh = (await this.elements(inputSelector))[index];
        this.evidence.commands++;
        await this.command(this.path(`/element/${fresh[elementKey]}/value`), { text: value });
        break;
      } catch (error) {
        if (attempt === 2 || !(error instanceof Error) || !error.message.includes('stale element reference')) throw error;
      }
    }
    await this.execute('mobile: hideKeyboard').catch(() => undefined);
    await this.settle();
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
  private nativeCondition(text: string, contains = false) {
    const normalized = (attribute: string) => `translate(normalize-space(@${attribute}),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')`;
    return ['text', 'content-desc'].map(attribute => contains
      ? `contains(${normalized(attribute)},${literal(text.toLowerCase())})`
      : `${normalized(attribute)}=${literal(text.toLowerCase())}`).join(' or ');
  }
  async nativeVisible(text: string, contains = false) {
    return (await this.elements(`//*[@displayed='true' and (${this.nativeCondition(text, contains)})]`)).length > 0;
  }
  async hasNative(text: string, contains = false) {
    this.evidence.assertions++;
    await expect.poll(() => this.nativeVisible(text, contains), { message: `Android system shows ${text}` }).toBe(true);
  }
  async tapNative(text: string, contains = false) {
    await this.hasNative(text, contains);
    const parents = await this.nativeActions(text, contains);
    expect(parents.length, `Native Android action ${text}`).toBeGreaterThan(0);
    await this.click(parents.at(-1)!);
  }
  private async nativeActions(text: string, contains = false) {
    const selector = `//*[@displayed='true' and (${this.nativeCondition(text, contains)})]`;
    const direct = await this.elements(`${selector}[@clickable='true' and @enabled='true']`);
    return direct.length ? direct : this.elements(`${selector}/ancestor::*[@displayed='true' and @clickable='true' and @enabled='true'][1]`);
  }
  async nativeActionVisible(text: string) { return (await this.nativeActions(text)).length > 0; }
  async source(): Promise<string> { return this.command(this.path('/source')); }
  async selectGalleryThumbnail() {
    const selector = `//*[@displayed='true' and (contains(@resource-id,':id/icon_thumbnail') or contains(@resource-id,':id/thumbnail') or contains(@content-desc,'Photo taken'))]`;
    await expect.poll(async () => (await this.elements(selector)).length, { message: 'Native gallery contains seeded photo' }).toBeGreaterThan(0);
    this.evidence.assertions++;
    await this.click((await this.elements(selector))[0]);
    await this.hasId(`${appPackage}:id/crop_image_menu_crop`);
    await this.tapId(`${appPackage}:id/crop_image_menu_crop`);
  }
  async seesImage() {
    this.evidence.assertions++;
    await expect.poll(async () => (await this.elements(`//android.widget.ImageView[@package='${appPackage}' and @displayed='true']`)).length).toBeGreaterThan(0);
  }
  async rankedPlayer(rank: number, name: string) {
    await this.seek(`#${rank}`);
    this.evidence.assertions++;
    const row = `${this.selector(`#${rank}`)}/ancestor::*[@clickable='true'][1]`;
    expect((await this.elements(`${row}//*[@text=${literal(name)}]`)).length, `${name} occupies native rank #${rank}`).toBeGreaterThan(0);
  }
  observePermissionRequests() {
    execFileSync('adb', ['logcat', '-b', 'main', '-b', 'system', '-c'], { timeout: 10_000 });
  }
  blockNotificationPermission() {
    execFileSync('adb', ['shell', 'pm', 'set-permission-flags', appPackage,
      'android.permission.POST_NOTIFICATIONS', 'user-set', 'user-fixed'], { timeout: 10_000 });
  }
  permissionRequests() {
    const log = execFileSync('adb', ['logcat', '-d', '-b', 'main', '-b', 'system', '-v', 'brief',
      'ActivityTaskManager:I', '*:S'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    return log.split('\n').filter(line => line.includes('REQUEST_PERMISSIONS')).length;
  }
  notificationPermission(granted: boolean) {
    const state = execFileSync('adb', ['shell', 'dumpsys', 'package', appPackage], {
      encoding: 'utf8', timeout: 10_000,
    });
    this.evidence.assertions++;
    expect(state.match(/android\.permission\.POST_NOTIFICATIONS: granted=(true|false)/)?.[1]).toBe(String(granted));
  }
  async attach(info: TestInfo) {
    await info.attach('android-evidence', { body: JSON.stringify(this.evidence), contentType: 'application/json' });
    if (this.session) {
      const screenshot = await this.command(this.path('/screenshot')).catch(() => null);
      if (screenshot) await info.attach('android-screen', { body: Buffer.from(screenshot, 'base64'), contentType: 'image/png' });
      if (info.status !== info.expectedStatus) {
        const xml = await this.command(this.path('/source')).catch(String);
        await info.attach('android-hierarchy', { body: xml, contentType: 'application/xml' });
        if (this.beforeScroll) await info.attach('android-before-scroll-hierarchy', { body: this.beforeScroll, contentType: 'application/xml' });
        for (const [name, args] of [
          ['android-crash-log', ['logcat', '-d', '-b', 'crash', '-v', 'threadtime']],
          ['android-app-log', ['logcat', '-d', '-v', 'threadtime', 'ReactNativeJS:V', 'AndroidRuntime:V', 'ActivityTaskManager:I', 'ActivityManager:I', 'libc:E', '*:S']],
        ] as const) {
          let log: string;
          try { log = execFileSync('adb', [...args], { encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }); }
          catch (error) { log = String(error); }
          await info.attach(name, { body: log, contentType: 'text/plain' });
        }
      }
    }
  }
}
