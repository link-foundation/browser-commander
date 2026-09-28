/**
 * Is headful Edge's renderer crash in this environment caused by automation?
 * Start Edge by hand (user data dir + fixed debugging port, no engine), open
 * several tabs through the DevTools HTTP endpoint and report which survive.
 *
 *   xvfb-run -a node experiments/issue-103/edge-hand-started.mjs [executablePath]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const executablePath = process.argv[2] || '/usr/bin/microsoft-edge';
const dir = mkdtempSync(join(tmpdir(), 'edge-hand-'));
writeFileSync(join(dir, 'First Run'), '');
writeFileSync(
  join(dir, 'Local State'),
  JSON.stringify({ browser: { last_whats_new_version: 9999 }, fre: { has_user_seen_fre: true } })
);
const port = 9000 + Math.floor(Math.random() * 1000);
const child = spawn(executablePath, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', (chunk) => (stderr += chunk));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const list = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map((t) => `${t.type}:${t.url}`);
try {
  for (let i = 0; i < 100; i++) {
    try { await list(); break; } catch { await sleep(100); }
  }
  console.log('initial', await list());
  for (const url of ['about:blank', 'edge://version', 'https://example.com', 'about:blank']) {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' });
    console.log('open', url, response.status);
    await sleep(1500);
  }
  await sleep(3000);
  console.log('after', await list());
  console.log('alive', child.exitCode === null);
} finally {
  child.kill('SIGKILL');
  await sleep(500);
  console.log('stderr crash lines:', stderr.split('\n').filter((l) => /crash|Trap|FATAL|renderer|sandbox|ERROR/i.test(l)).slice(0, 15).join('\n'));
  rmSync(dir, { recursive: true, force: true });
}
