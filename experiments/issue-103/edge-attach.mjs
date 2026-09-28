/**
 * Hand-start headful Edge, then attach Playwright over CDP and exercise
 * newPage/goto, printing Edge's stderr lines that mention a crash.
 *
 *   xvfb-run -a node experiments/issue-103/edge-attach.mjs [executablePath] [delayMs] [spawn|startProcess] [steps: front,media,shot,local]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProcess } from '../../js/src/utilities/subprocess.js';
import { chromium } from '../../js/node_modules/playwright/index.mjs';

const executablePath = process.argv[2] || '/usr/bin/microsoft-edge';
const delay = Number(process.argv[3] || 0);
const dir = mkdtempSync(join(tmpdir(), 'edge-attach-'));
writeFileSync(join(dir, 'First Run'), '');
writeFileSync(join(dir, 'Local State'), JSON.stringify({ browser: { last_whats_new_version: 9999 }, fre: { has_user_seen_fre: true } }));
const port = 9000 + Math.floor(Math.random() * 1000);
const argv = [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, 'about:blank'];
const child =
  process.argv[4] === 'startProcess'
    ? startProcess(executablePath, argv)
    : spawn(executablePath, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', (chunk) => (stderr += chunk));
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<title>ok</title><p>ok</p>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(100); }
  }
  await sleep(delay);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  browser.on('disconnected', () => console.log('DISCONNECTED'));
  const context = browser.contexts()[0];
  console.log('contexts', browser.contexts().length, 'pages', context?.pages().map((p) => p.url()));
  const page = context.pages()[0];
  page.on('crash', () => console.log('PAGE CRASH', page.url()));
  const steps = (process.argv[5] || '').split(',');
  if (steps.includes('media')) {
    await page.emulateMedia({ colorScheme: 'light' });
    console.log('emulateMedia done');
  }
  if (steps.includes('front')) {
    await page.bringToFront();
    console.log('bringToFront done');
  }
  await page.goto(steps.includes('local') ? `http://127.0.0.1:${server.address().port}/` : 'https://example.com').then(() => console.log('goto ok'), (e) => console.log('goto failed', e.message.split('\n')[0]));
  if (steps.includes('shot')) {
    await page.screenshot().then(() => console.log('shot ok'), (e) => console.log('shot failed', e.message.split('\n')[0]));
  }
  const other = await context.newPage();
  other.on('crash', () => console.log('OTHER CRASH'));
  await other.goto('edge://version').then(() => console.log('version ok'), (e) => console.log('version failed', e.message.split('\n')[0]));
  await sleep(2000);
  console.log('alive', child.exitCode === null, 'signal', child.signalCode ?? null);
} catch (error) {
  console.log('ERROR', error.message.split('\n')[0], 'alive', child.exitCode === null, 'signal', child.signalCode ?? null);
} finally {
  await browser?.close().catch(() => {});
  child.kill('SIGKILL');
  await sleep(500);
  console.log(stderr.split('\n').filter((l) => !/dbus|object_proxy/.test(l) && /crash|Trap|FATAL|renderer|gpu|Check failed/i.test(l)).slice(0, 15).join('\n'));
  server.close();
  rmSync(dir, { recursive: true, force: true });
}
