// Experiment (#103): launch headful Chrome with exactly
// --user-data-dir=<fresh> --remote-debugging-port=<reserved> (+ optional args
// from ARGS, space separated), with the "First Run" sentinel written, and
// print READY once DevTools is up so chrome-window-shot.sh can capture the
// real window (infobars and bubbles included).
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executable = process.env.CHROME ?? '/usr/bin/google-chrome';
const server = net.createServer().listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port;
await new Promise((r) => server.close(r));
const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-window-'));
if (process.env.SENTINEL !== 'false')
  await writeFile(path.join(dir, 'First Run'), '');
const extra = (process.env.ARGS ?? '').split(' ').filter(Boolean);
const args = [
  `--user-data-dir=${dir}`,
  `--remote-debugging-port=${port}`,
  ...extra,
];
if (process.env.URL) args.push(process.env.URL);
const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
child.stderr.resume();
let version = null;
for (let i = 0; i < 80 && !version; i++) {
  version = await fetch(`http://127.0.0.1:${port}/json/version`)
    .then((r) => r.json())
    .catch(() => null);
  if (!version) await new Promise((r) => setTimeout(r, 250));
}
console.log(
  `args ${JSON.stringify(args.slice(2))} devtools=${Boolean(version)}`
);
console.log('READY');
process.stdin.resume();
await new Promise((r) => process.stdin.once('end', r));
child.kill();
await new Promise((r) => setTimeout(r, 800));
await rm(dir, { recursive: true, force: true });
