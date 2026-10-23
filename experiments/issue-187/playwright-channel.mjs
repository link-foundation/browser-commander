// Does a Playwright engine launch keep a session cookie across a restart?
//   node experiments/issue-187/playwright-channel.mjs [channel|-] [switch ...]
// '-' uses Playwright's default (headless shell when headless).
import { chromium } from '../../js/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const [channel, ...switches] = process.argv.slice(2);
const dir = fs.mkdtempSync('/tmp/bc-pw-');
const headless = process.env.HEADFUL !== '1';
const opts = {
  headless,
  args: ['--no-sandbox', ...switches],
  ...(channel && channel !== '-' ? { channel } : {}),
};
let ctx = await chromium.launchPersistentContext(dir, opts);
await ctx.addCookies([
  {
    name: 'session_login',
    value: 'x',
    domain: 'example.com',
    path: '/',
    secure: true,
  },
]);
await ctx.close();
if (process.env.CLEAR_SESSIONS) {
  fs.rmSync(path.join(dir, 'Default', 'Sessions'), {
    recursive: true,
    force: true,
  });
}
ctx = await chromium.launchPersistentContext(dir, opts);
const cookies = (await ctx.cookies()).map((c) => c.name);
console.log(
  JSON.stringify({
    channel,
    headless,
    switches,
    clear: Boolean(process.env.CLEAR_SESSIONS),
    cookies,
    pages: ctx.pages().length,
  })
);
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
