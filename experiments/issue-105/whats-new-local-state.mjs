// Does seeding Local State `browser.last_whats_new_version` stop the
// "What's new" tab a fresh profile opens next to the New Tab page?
// Usage: xvfb-run -a node experiments/issue-105/whats-new-local-state.mjs [9999|153|none]
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reserveLoopbackPort } from '../../js/src/browser/debugging-port.js';

const seed = process.argv[2] ?? '9999';
const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-whatsnew-'));
await writeFile(path.join(dir, 'First Run'), '');
if (seed !== 'none') {
  await writeFile(
    path.join(dir, 'Local State'),
    JSON.stringify({ browser: { last_whats_new_version: Number(seed) } })
  );
}
const port = await reserveLoopbackPort();
const chrome = spawn(
  process.env.CHROME_PATH ?? 'google-chrome',
  [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`],
  { stdio: 'ignore' }
);
let tabs = [];
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try {
    tabs = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
      .filter((t) => t.type === 'page')
      .map((t) => t.url);
  } catch {}
}
chrome.kill();
await new Promise((r) => chrome.once('exit', r));
const state = JSON.parse(await readFile(path.join(dir, 'Local State'), 'utf8'));
console.log(
  JSON.stringify({
    seed,
    tabs,
    lastWhatsNew: state.browser?.last_whats_new_version,
  })
);
await rm(dir, { recursive: true, force: true });
