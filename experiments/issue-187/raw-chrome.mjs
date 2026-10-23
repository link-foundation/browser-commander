// Raw Chrome check for issue #187, without Browser Commander: start Chrome
// with --user-data-dir, set a session cookie and a persistent one over CDP,
// close with Browser.close, start again and list the cookies.
//
//   node experiments/issue-187/raw-chrome.mjs <chrome> [switch ...]
// NO_URL=1 starts without a URL (as chromiumoxide does); CLEAR_SESSIONS=1 deletes
// Default/Sessions before the second start.
// e.g. ... raw-chrome.mjs ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome --headless=new --no-sandbox
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [chrome, ...switches] = process.argv.slice(2);
const dir = fs.mkdtempSync('/tmp/bc-raw-');
fs.writeFileSync(path.join(dir, 'First Run'), '');
let port = 9400 + Math.floor(Math.random() * 400);

async function start() {
  port += 1;
  const child = spawn(
    chrome,
    [
      `--user-data-dir=${dir}`,
      `--remote-debugging-port=${port}`,
      ...switches,
      ...(process.env.NO_URL ? [] : ['about:blank']),
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  child.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try {
      const v = await (
        await fetch(`http://127.0.0.1:${port}/json/version`)
      ).json();
      const ws = new globalThis.WebSocket(v.webSocketDebuggerUrl);
      await new Promise((r) => ws.addEventListener('open', r));
      let id = 0;
      const waiting = new Map();
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        waiting.get(m.id)?.(m);
      });
      const send = (method, params = {}) =>
        new Promise((r) => {
          const n = ++id;
          waiting.set(n, r);
          ws.send(JSON.stringify({ id: n, method, params }));
        });
      return { child, send };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('no endpoint');
}
const exited = (child) =>
  new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
const exitType = () =>
  JSON.parse(fs.readFileSync(path.join(dir, 'Default', 'Preferences'), 'utf8'))
    .profile?.exit_type;

let b = await start();
await b.send('Storage.setCookies', {
  cookies: [
    {
      name: 'session_login',
      value: 'x',
      domain: 'example.com',
      path: '/',
      secure: true,
    },
    {
      name: 'persistent_pref',
      value: 'y',
      domain: 'example.com',
      path: '/',
      secure: true,
      expires: Date.now() / 1000 + 86400,
    },
  ],
});
await new Promise((r) => setTimeout(r, Number(process.env.SETTLE_MS ?? 0)));
await b.send('Browser.close');
await exited(b.child);
const first = exitType();
if (process.env.CLEAR_SESSIONS) {
  fs.rmSync(path.join(dir, 'Default', 'Sessions'), {
    recursive: true,
    force: true,
  });
}
b = await start();
const { result } = await b.send('Storage.getCookies');
const targets = (await b.send('Target.getTargets')).result.targetInfos.filter(
  (t) => t.type === 'page'
);
await b.send('Browser.close');
await exited(b.child);
console.log(
  JSON.stringify({
    switches,
    clearSessions: Boolean(process.env.CLEAR_SESSIONS),
    exitTypeAfterFirstClose: first,
    cookies: result.cookies.map((c) => c.name).sort(),
    pages: targets.length,
  })
);
fs.rmSync(dir, { recursive: true, force: true });
