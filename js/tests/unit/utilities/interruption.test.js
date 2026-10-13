import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  interruptionMode,
  startProcess,
} from '../../../src/utilities/subprocess.js';
import { repoPath } from '../../helpers/repo.js';

// feature-parity: process.interruption@native-typed

const node = process.execPath;
const unixOnly = {
  timeout: 15000,
  skip:
    process.platform === 'win32' &&
    'Command Stream only creates separate process groups on Unix',
};

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}

function forceKill(pid) {
  if (pid && isAlive(pid)) {
    process.kill(pid, 'SIGKILL');
  }
}

async function tempDirectory(t, prefix) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * Run an embedding supervisor that interrupts itself, keeps its child from
 * its own SIGINT handler, and exits. Returns whether the child survived.
 */
async function childSurvivesSupervisorInterrupt(t, mode) {
  const directory = await tempDirectory(t, 'bc-interrupt-174-');
  const pidFile = path.join(directory, 'pid');
  const supervisor = startProcess(node, [
    repoPath('experiments', 'issue-174', 'sigint-supervisor.mjs'),
    mode,
    pidFile,
  ]);
  assert.equal(await supervisor.exited, 130, supervisor.stderrTail);
  const pid = Number(await fs.readFile(pidFile, 'utf8'));
  t.after(() => forceKill(pid));
  assert.ok(pid > 0);
  await new Promise((resolve) => setTimeout(resolve, 300));
  return isAlive(pid);
}

describe('interruption ownership (issue #174)', unixOnly, () => {
  it('forwards SIGINT to the child by default, before the embedder can keep it', async (t) => {
    assert.equal(await childSurvivesSupervisorInterrupt(t, 'managed'), false);
    assert.equal(
      await childSurvivesSupervisorInterrupt(t, 'detach-in-handler'),
      false
    );
  });

  it("leaves SIGINT to the embedder's handler with interruption: 'caller'", async (t) => {
    assert.equal(await childSurvivesSupervisorInterrupt(t, 'caller'), true);
  });

  it('keeps streaming output and reporting the exit code for a caller-owned child', async () => {
    const child = startProcess(
      node,
      [
        '-e',
        'setTimeout(()=>{process.stderr.write("hello\\n");process.exit(4)},100)',
      ],
      { interruption: 'caller' }
    );
    assert.equal(child.interruption, 'caller');
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    assert.equal(await child.exited, 4);
    assert.equal(stderr, 'hello\n');
    assert.equal(child.kill(), false);
  });

  it('kill() still awaits the actual exit of a caller-owned child', async (t) => {
    const directory = await tempDirectory(t, 'bc-caller-kill-174-');
    const marker = path.join(directory, 'flushed');
    const child = startProcess(
      node,
      [repoPath('experiments', 'issue-172', 'delayed-shutdown.mjs'), marker],
      { interruption: 'caller', killGrace: 1000 }
    );
    t.after(() => forceKill(child.pid));
    await new Promise((resolve) => child.stdout.on('data', resolve));
    assert.equal(child.kill(), true);
    assert.equal(await child.exited, 0);
    assert.equal(await fs.readFile(marker, 'utf8'), 'flushed');
    assert.equal(isAlive(child.pid), false);
  });

  it('escalates to SIGKILL when a caller-owned child ignores SIGTERM', async (t) => {
    const child = startProcess(
      node,
      [
        '-e',
        'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)',
      ],
      { interruption: 'caller', killGrace: 200 }
    );
    t.after(() => forceKill(child.pid));
    await new Promise((resolve) => child.stdout.on('data', resolve));
    child.kill();
    assert.equal(await child.exited, 128 + 9);
    assert.equal(child.signalCode, 'SIGKILL');
  });

  it('detach() lets the supervisor end while the exact child keeps running', async (t) => {
    const directory = await tempDirectory(t, 'bc-detach-174-');
    const marker = path.join(directory, 'survived');
    const launcher = startProcess(node, [
      repoPath('experiments', 'issue-174', 'detach-launcher.mjs'),
      marker,
    ]);
    let output = '';
    launcher.stdout.on('data', (chunk) => {
      output += chunk;
    });
    assert.equal(await launcher.exited, 0, launcher.stderrTail);
    const { pid, detached } = JSON.parse(output);
    t.after(() => forceKill(pid));
    assert.equal(detached, true);
    assert.equal(isAlive(pid), true);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        assert.equal(await fs.readFile(marker, 'utf8'), 'survived');
        return;
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    assert.fail('detached child did not outlive its supervisor');
  });

  it('detach() is idempotent and a detached child can still be stopped', async () => {
    const child = startProcess(node, ['-e', 'setInterval(()=>{},1000)'], {
      killGrace: 200,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(child.detach(), true);
    assert.equal(child.detach(), true);
    assert.equal(child.detached, true);
    assert.equal(child.kill(), true);
    assert.equal(await child.exited, 128 + 15);
    assert.equal(child.detach(), false);
  });
});

describe('interruptionMode', () => {
  it('defaults to managed and rejects unknown modes', () => {
    assert.equal(interruptionMode(), 'managed');
    assert.equal(interruptionMode('caller'), 'caller');
    assert.throws(() => interruptionMode('detached'), TypeError);
    assert.throws(
      () => startProcess(node, [], { interruption: 'none' }),
      /interruption must be one of managed, caller/
    );
  });
});
