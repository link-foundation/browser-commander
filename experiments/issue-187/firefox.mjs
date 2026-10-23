// Firefox under geckodriver (`-profile <dir>`, as Browser Commander's
// Selenium launch does): does a session cookie survive driver.quit() and a
// relaunch, and which user.js prefs make it survive (issue #187)?
//
//   node experiments/issue-187/firefox.mjs <variant>
//   variants: none | startup-page-3 | startup-page-3+privacy
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from '../../js/src/index.js';

const variant = process.argv[2] ?? 'none';
const PREFS = {
  none: {},
  'startup-page-3': { 'browser.startup.page': 3 },
  'startup-page-3+privacy': {
    'browser.startup.page': 3,
    'browser.sessionstore.privacy_level': 0,
  },
  'resume-once': { 'browser.sessionstore.resume_session_once': true },
};
const userDataDir = fs.mkdtempSync('/tmp/bc-ff-');
const writePrefs = () => {
  const lines = Object.entries(PREFS[variant]).map(
    ([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`
  );
  if (lines.length) {
    fs.appendFileSync(
      path.join(userDataDir, 'user.js'),
      `${lines.join('\n')}\n`
    );
  }
};
const open = () =>
  launchBrowser({
    engine: 'selenium',
    launch: 'engine',
    browser: 'firefox',
    userDataDir,
    headless: true,
    executablePath: process.env.FIREFOX,
    driverPath: process.env.GECKODRIVER,
    keepSessionCookies:
      process.env.KEEP === undefined ? undefined : process.env.KEEP === 'true',
  });
writePrefs();
let s = await open();
const d = s.driver;
await d.get('https://example.com/');
await d.manage().addCookie({ name: 'session_login', value: 'x' });
await d.manage().addCookie({
  name: 'persistent_pref',
  value: 'y',
  expiry: new Date(Date.now() + 86400e3),
});
console.log('warnings', s.warnings);
await s.close();
s = await open();
await s.driver.get('https://example.com/');
const names = (await s.driver.manage().getCookies()).map((c) => c.name);
const handles = await s.driver.getAllWindowHandles();
console.log(
  JSON.stringify({
    variant,
    session_login: names.includes('session_login'),
    persistent_pref: names.includes('persistent_pref'),
    windows: handles.length,
    userJs: fs.existsSync(path.join(userDataDir, 'user.js'))
      ? fs
          .readFileSync(path.join(userDataDir, 'user.js'), 'utf8')
          .split('\n')
          .filter((l) => /startup|sessionstore/.test(l))
      : null,
  })
);
await s.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
