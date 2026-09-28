// Experiment (#101): does Chrome write DevToolsActivePort for a fixed,
// non-zero --remote-debugging-port? (confirmation signal for the reserved port)
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executable = process.env.CHROME ?? '/usr/bin/google-chrome';
const headless = process.env.HEADLESS !== 'false';
const server = net.createServer().listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port;
await new Promise((r) => server.close(r));
const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-active-port-'));
const args = [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, ...(headless ? ['--headless=new'] : []), 'about:blank'];
const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 4000)));
let activePort = null;
try { activePort = await readFile(path.join(dir, 'DevToolsActivePort'), 'utf8'); } catch {}
const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch((e) => String(e));
console.log({ headless, port, activePort, version: version.Browser ?? version, listening: stderr.split('\n').filter((l) => /DevTools listening|ERROR/.test(l)).slice(0, 8) });
child.kill();
await new Promise((r) => setTimeout(r, 500));
await rm(dir, { recursive: true, force: true });
