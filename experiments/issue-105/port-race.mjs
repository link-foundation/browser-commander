// Experiment (#101): what does Chrome do when the fixed --remote-debugging-port
// is already taken by another listener? Confirms which signal to use for the
// port-race retry (DevToolsActivePort absent + stderr message).
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executable = process.env.CHROME ?? '/usr/bin/google-chrome';
const blocker = net.createServer().listen(0, '127.0.0.1');
await new Promise((r) => blocker.once('listening', r));
const port = blocker.address().port;
const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-port-race-'));
const child = spawn(executable, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, '--headless=new', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
await new Promise((r) => setTimeout(r, 4000));
let activePort = null;
try { activePort = await readFile(path.join(dir, 'DevToolsActivePort'), 'utf8'); } catch {}
console.log({ port, exitCode: child.exitCode, activePort, stderrTail: stderr.split('\n').filter((l) => /devtools|http server|bind/i.test(l)) });
child.kill();
blocker.close();
await new Promise((r) => setTimeout(r, 500));
await rm(dir, { recursive: true, force: true });
