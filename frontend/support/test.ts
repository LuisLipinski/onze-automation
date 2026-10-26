import { test as base, expect } from '@playwright/test';
import { Control } from '../../tests/support/test';
import { Android } from './android';

export const test = base.extend<{ ui: Android; control: Control; isolated: void }, { android: Android }>({
  android: [async ({}, use) => {
    const android = new Android();
    await android.start();
    try { await use(android); } finally { await android.stop(); }
  }, { scope: 'worker' }],
  control: async ({}, use) => { await use(new Control('http://127.0.0.1:8090')); },
  isolated: [async ({ control, android }, use) => { await android.execute('mobile: terminateApp', { appId: 'com.onze.organizadordepelada' }); await control.call('/reset', {}); await use(); }, { auto: true }],
  ui: async ({ android, isolated }, use, info) => {
    void isolated;
    await android.reset();
    try { await use(android); } finally { await android.attach(info); }
  },
});
export { expect };
