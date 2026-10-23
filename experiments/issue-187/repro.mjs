// Reproduce issue #187: a session cookie (no expiry) is lost when a browser
// started with an explicit userDataDir is closed normally and relaunched.
//
//   node experiments/issue-187/repro.mjs [engine] [launch] [extra-json]
import fs from 'node:fs';
import { launchBrowser } from '../../js/src/index.js';

const engine = process.argv[2] ?? 'playwright';
const launch = process.argv[3] ?? 'real';
const extra = JSON.parse(process.argv[4] ?? '{}');
const userDataDir = fs.mkdtempSync('/tmp/bc-profile-');
const open = () =>
  launchBrowser({ engine, launch, userDataDir, headless: true, ...extra });

const cookies = [
  { name: 'session_login', value: 'x', domain: 'example.com', path: '/', secure: true },
  { name: 'persistent_pref', value: 'y', domain: 'example.com', path: '/', secure: true,
    expires: Math.floor(Date.now() / 1000) + 86400 },
];
let session = await open();
if (engine === 'puppeteer') await session.browser.setCookie(...cookies);
else await session.browser.addCookies(cookies);
console.log('first launch pages:', session.browser.pages ? (await session.browser.pages()).length : '?', 'warnings:', session.warnings);
await session.close();

session = await open();
const list = engine === 'puppeteer' ? await session.browser.cookies() : await session.browser.cookies();
const names = list.map((c) => c.name);
const pages = await session.browser.pages();
console.log({ engine, launch, ...extra,
  persistent_pref: names.includes('persistent_pref'),
  session_login: names.includes('session_login'),
  pages: pages.length, urls: pages.map((p) => p.url()), args: session.args });
await session.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
