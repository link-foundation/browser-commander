// Experiment (#101/#103): does headful Chrome with only
// --user-data-dir + --remote-debugging-port=<fixed> expose DevTools, and does
// writing the "First Run" sentinel (instead of --no-first-run) matter?
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executable = process.env.CHROME ?? '/usr/bin/google-chrome';
const sentinel = process.env.SENTINEL === 'true';
const server = net.createServer().listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port;
await new Promise((r) => server.close(r));
const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-headful-'));
if (sentinel) await writeFile(path.join(dir, 'First Run'), '');
const child = spawn(executable, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stderr.on('data', (d) => (output += d));
child.stdout.on('data', (d) => (output += d));
const deadline = Date.now() + Number(process.env.WAIT ?? 15000);
let version = null;
while (Date.now() < deadline && !version) {
  version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null);
  if (!version) await new Promise((r) => setTimeout(r, 250));
}
let webdriver = null;
if (version) {
  const { chromium } = await import(new URL('../../js/node_modules/playwright/index.mjs', import.meta.url));
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0] ?? (await browser.contexts()[0].newPage());
  webdriver = await page.evaluate(() => navigator.webdriver);
  await browser.close().catch(() => {});
}
console.log({ sentinel, port, alive: child.exitCode === null, version: version?.Browser ?? null, webdriver, listening: output.split('\n').filter((l) => /DevTools listening|remote debugging|devtools/i.test(l)) });
child.kill();
await new Promise((r) => setTimeout(r, 800));
await rm(dir, { recursive: true, force: true });
