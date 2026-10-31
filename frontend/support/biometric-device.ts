import { execFileSync } from 'node:child_process';
import { Android } from './android';

const devices = new WeakSet<Android>();
const pin = '1234';
const adb = (...args: string[]) => execFileSync('adb', args, { encoding: 'utf8', timeout: 15_000 });

/** Enroll through Android Settings; the app's biometric API remains unchanged. */
export async function enrollFingerprint(ui: Android) {
  adb('shell', 'locksettings', 'set-pin', pin);
  devices.add(ui);
  adb('shell', 'am', 'start', '-a', 'android.settings.FINGERPRINT_ENROLL');
  let pinSubmitted = false;
  for (let step = 0; step < 35; step++) {
    const source = await ui.source();
    if (/Fingerprint added|Fingerprint setup complete|Fingerprint is ready/i.test(source)) {
      if (await ui.nativeVisible('Done')) await ui.tapNative('Done');
      await ui.execute('mobile: activateApp', { appId: 'com.onze.organizadordepelada' });
      await ui.has('E-mail');
      return;
    }
    const pinPage = /password_entry|android\.widget\.EditText/.test(source);
    if (pinPage && !pinSubmitted) {
      adb('shell', 'input', 'text', pin);
      adb('shell', 'input', 'keyevent', '66');
      pinSubmitted = true;
    } else {
      if (!pinPage) pinSubmitted = false;
      let advanced = false;
      for (const label of ['I agree', 'Next', 'Continue', 'More', 'Get started', 'Start']) {
        if (await ui.nativeVisible(label)) {
          await ui.tapNative(label);
          advanced = true;
          break;
        }
      }
      if (!advanced && /touch|lift|sensor/i.test(source)) {
        adb('emu', 'finger', 'touch', '1');
        adb('emu', 'finger', 'remove');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Android did not finish native fingerprint enrollment; inspect hierarchy');
}

export async function clearFingerprint(ui: Android) {
  if (!devices.has(ui)) return;
  adb('shell', 'locksettings', 'clear', '--old', pin);
  adb('shell', 'am', 'force-stop', 'com.android.settings');
  devices.delete(ui);
}
