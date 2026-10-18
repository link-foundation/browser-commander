// Runs sigint-supervisor.mjs and reports whether its child survived SIGINT.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const mode = process.argv[2] ?? 'managed';
const directory = mkdtempSync(path.join(tmpdir(), 'bc-174-'));
const pidFile = path.join(directory, 'pid');
const result = spawnSync(
  process.execPath,
  [new URL('./sigint-supervisor.mjs', import.meta.url).pathname, mode, pidFile],
  { encoding: 'utf8', timeout: 10000 }
);
const pid = Number(readFileSync(pidFile, 'utf8'));
await new Promise((resolve) => setTimeout(resolve, 300));
let alive = true;
try {
  process.kill(pid, 0);
} catch {
  alive = false;
}
console.log(
  JSON.stringify({
    mode,
    supervisorExit: result.status,
    stderr: result.stderr.trim(),
    childAlive: alive,
  })
);
if (alive) {
  process.kill(pid, 'SIGKILL');
}
rmSync(directory, { recursive: true, force: true });
