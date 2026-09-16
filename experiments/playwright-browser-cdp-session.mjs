/**
 * Does a Playwright persistent context expose a browser-wide CDP session?
 *
 * Manual downloads are only observable through the Browser domain on a session
 * that is not scoped to one page, so this checks what is reachable from what
 * `launchBrowser()` hands back.
 */
import { chromium } from 'playwright';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-cdp-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  args: ['--no-sandbox'],
});

const browser = context.browser();
console.log('context.browser():', typeof browser, !!browser);
console.log(
  'newBrowserCDPSession on browser:',
  typeof browser?.newBrowserCDPSession
);
console.log('newCDPSession on context:', typeof context.newCDPSession);

if (browser?.newBrowserCDPSession) {
  const session = await browser.newBrowserCDPSession();
  console.log('browser session opened:', typeof session.send);
  const targets = await session.send('Target.getTargets');
  console.log('targets seen:', targets.targetInfos.length);
}

await context.close();
await fs.rm(userDataDir, { recursive: true, force: true });
