// Firefox with browser.startup.page=3: how many windows does a relaunch
// restore after a session that had two tabs, and when do they appear?
//   FIREFOX=... GECKODRIVER=... node experiments/issue-187/firefox-tabs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../../js/src/index.js';

const userDataDir = fs.mkdtempSync('/tmp/bc-ff-tabs-');
fs.writeFileSync(
  path.join(userDataDir, 'user.js'),
  'user_pref("browser.startup.page", 3);\n'
);
const open = () =>
  launchBrowser({
    engine: 'selenium',
    launch: 'engine',
    browser: 'firefox',
    userDataDir,
    headless: true,
    executablePath: process.env.FIREFOX,
    driverPath: process.env.GECKODRIVER,
    ...(process.env.KEEP
      ? { keepSessionCookies: process.env.KEEP === 'true' }
      : {}),
  });
let s = await open();
await s.driver.get('https://example.com/');
await s.driver.manage().addCookie({ name: 'session_login', value: 'x' });
await s.driver.switchTo().newWindow('tab');
await s.driver.get('https://example.org/');
console.log(
  'first launch windows',
  (await s.driver.getAllWindowHandles()).length,
  'warnings',
  s.warnings
);
await s.close();
s = await open();
const counts = [];
for (const delay of [0, 500, 1500, 3000]) {
  await new Promise((r) => setTimeout(r, delay));
  counts.push((await s.driver.getAllWindowHandles()).length);
}
const current = await s.driver.getCurrentUrl();
await s.driver.get('https://example.com/');
const names = (await s.driver.manage().getCookies()).map((c) => c.name);
console.log(JSON.stringify({ counts, current, cookies: names }));
await s.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
