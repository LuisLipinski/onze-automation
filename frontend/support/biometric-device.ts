import { execFileSync } from 'node:child_process';
import { expect, type TestInfo } from '@playwright/test';
import { Android } from './android';

const devices = new WeakSet<Android>();
const pin = '1234';
const adb = (...args: string[]) => execFileSync('adb', args, { encoding: 'utf8', timeout: 15_000 });
function hasEnrolledFingerprint(state: string) {
  return [...state.matchAll(/"prints"\s*:\s*(\[[^\]]*\])/g)].some(match =>
    (JSON.parse(match[1]) as { id: number; count: number }[]).some(user => user.id === 0 && user.count > 0));
}

/** Enroll through Android Settings; the app's biometric API remains unchanged. */
export async function enrollFingerprint(ui: Android, info: TestInfo) {
  adb('shell', 'locksettings', 'set-pin', pin);
  devices.add(ui);
  let device = adb('shell', 'dumpsys', 'fingerprint');
  await info.attach('fingerprint-device-before', { body: device, contentType: 'text/plain' });
  adb('shell', 'am', 'start', '-a', 'android.settings.FINGERPRINT_ENROLL');
  await expect.poll(() => ui.execute('mobile: getCurrentPackage')).toBe('com.android.settings');
  let pinSubmitted = false;
  let lastSource = '';
  for (let step = 0; step < 35; step++) {
    const source = await ui.source();
    lastSource = source;
    if (step % 3 === 0) device = adb('shell', 'dumpsys', 'fingerprint');
    if (hasEnrolledFingerprint(device) || /Fingerprint added|Fingerprint setup complete|Fingerprint is ready/i.test(source)) {
      await expect.poll(() => hasEnrolledFingerprint(adb('shell', 'dumpsys', 'fingerprint'))).toBe(true);
      await info.attach('fingerprint-device-enrolled', { body: adb('shell', 'dumpsys', 'fingerprint'), contentType: 'text/plain' });
      if (await ui.nativeVisible('Done')) await ui.tapNative('Done');
      await ui.execute('mobile: activateApp', { appId: 'com.onze.organizadordepelada' });
      await ui.has('E-mail');
      return;
    }
    const settings = [...source.matchAll(/<[^/!?][^>]*>/g)].map(match => match[0])
      .filter(tag => tag.includes('package="com.android.settings"') && tag.includes('displayed="true"'));
    const pinPage = settings.some(tag => /password_entry|android\.widget\.EditText/.test(tag));
    if (pinPage && !pinSubmitted) {
      adb('shell', 'input', 'text', pin);
      adb('shell', 'input', 'keyevent', '66');
      pinSubmitted = true;
    } else {
      if (!pinPage) pinSubmitted = false;
      let advanced = false;
      for (const label of ['I agree', 'Agree & continue', 'Agree and continue', 'Next', 'Continue', 'More', 'Get started', 'Set up', 'Set up fingerprint', 'Use fingerprint', 'Start']) {
        if (await ui.nativeActionVisible(label)) {
          await ui.tapNative(label);
          advanced = true;
          break;
        }
      }
      if (!advanced && /touch|lift|sensor/i.test(source)) {
        adb('emu', 'finger', 'touch', '1');
        await new Promise(resolve => setTimeout(resolve, 250));
        adb('emu', 'finger', 'remove');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await info.attach('fingerprint-enrollment-hierarchy', { body: lastSource, contentType: 'application/xml' });
  await info.attach('fingerprint-device-failed', { body: device, contentType: 'text/plain' });
  const labels = [...new Set([...lastSource.matchAll(/\btext="([^"]+)"/g)].map(match => match[1]))];
  throw new Error(`Android did not finish native fingerprint enrollment. Visible labels: ${JSON.stringify(labels)}`);
}

export async function clearFingerprint(ui: Android) {
  if (!devices.has(ui)) return;
  adb('shell', 'locksettings', 'clear', '--old', pin);
  adb('shell', 'am', 'force-stop', 'com.android.settings');
  devices.delete(ui);
}
