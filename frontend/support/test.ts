import { test as base, expect } from '@playwright/test';
import { Control } from '../../tests/support/test';
import { Android, type NotificationPermission } from './android';

export const test = base.extend<{ ui: Android; control: Control; isolated: void; notificationPermission: NotificationPermission }, { android: Android }>({
  notificationPermission: ['granted', { option: true }],
  android: [async ({}, use) => {
    const android = new Android();
    await android.start();
    try { await use(android); } finally { await android.stop(); }
  }, { scope: 'worker' }],
  control: async ({}, use) => { await use(new Control('http://127.0.0.1:8090')); },
  isolated: [async ({ control, android }, use) => { await android.execute('mobile: terminateApp', { appId: 'com.onze.organizadordepelada' }); await control.call('/reset', {}); await use(); }, { auto: true }],
  ui: async ({ android, isolated, notificationPermission }, use, info) => {
    void isolated;
    await android.reset(true, notificationPermission);
    try { await use(android); } finally { await android.attach(info); }
  },
});
export { expect };
