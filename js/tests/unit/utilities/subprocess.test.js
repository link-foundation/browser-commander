import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CommandError,
  runCommand,
  startProcess,
} from '../../../src/utilities/subprocess.js';
import { repoPath } from '../../helpers/repo.js';

const node = process.execPath;

describe('runCommand', { timeout: 10000 }, () => {
  it('passes arguments without a shell and captures output', async () => {
    const result = await runCommand(node, [
      '-e',
      'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
      'a b',
      '$HOME',
      '"q"',
    ]);
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), ['a b', '$HOME', '"q"']);
  });

  it('writes input to stdin and sets the child environment only', async () => {
    const result = await runCommand(
      node,
      [
        '-e',
        'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(s+process.env.BC_TEST_ONLY))',
      ],
      { input: 'in:', env: { ...process.env, BC_TEST_ONLY: 'child' } }
    );
    assert.equal(result.stdout, 'in:child');
    assert.equal(process.env.BC_TEST_ONLY, undefined);
  });

  it('throws CommandError on a non-zero exit unless check is false', async () => {
    const args = ['-e', 'process.stderr.write("boom");process.exit(3)'];
    await assert.rejects(
      () => runCommand(node, args),
      (error) =>
        error instanceof CommandError &&
        error.code === 3 &&
        error.stderr === 'boom'
    );
    const result = await runCommand(node, args, { check: false });
    assert.equal(result.code, 3);
  });

  it('reports a missing executable as exit 127 with ENOENT diagnostics', async () => {
    const file = path.join(tmpdir(), 'bc-missing-executable-164', 'missing');
    await assert.rejects(
      () => runCommand(file),
      (error) => {
        assert.ok(error instanceof CommandError);
        assert.equal(error.code, 127);
        assert.match(error.stderr, /ENOENT/);
        return true;
      }
    );
    const result = await runCommand(file, [], { check: false });
    assert.equal(result.code, 127);
    assert.match(result.stderr, /ENOENT/);
  });
});

describe('startProcess', { timeout: 10000 }, () => {
  it('streams output and reports the exit code', async () => {
    const child = startProcess(node, [
      '-e',
      'process.stderr.write("hello\\n");process.exit(4)',
    ]);
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exitCode = await new Promise((resolve) =>
      child.once('exit', resolve)
    );
    assert.equal(exitCode, 4);
    assert.equal(stderr, 'hello\n');
    assert.equal(await child.exited, 4);
    assert.equal(child.kill(), false);
  });

  it('kills a running process', async () => {
    const child = startProcess(node, ['-e', 'setInterval(() => {}, 1000)'], {
      killGrace: 200,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(child.pid > 0);
    assert.equal(child.kill(), true);
    const exitCode = await child.exited;
    assert.notEqual(exitCode, 0);
  });

  it(
    'reports exit only after a signalled child finishes its profile writes',
    { skip: process.platform === 'win32' && 'Windows termination is forceful' },
    async (t) => {
      const directory = await fs.mkdtemp(
        path.join(tmpdir(), 'bc-shutdown-172-')
      );
      const marker = path.join(directory, 'flushed');
      const child = startProcess(
        node,
        [repoPath('experiments', 'issue-172', 'delayed-shutdown.mjs'), marker],
        { killGrace: 1000 }
      );
      const processHandle = child.runner.child;
      t.after(async () => {
        if (
          processHandle.exitCode === null &&
          processHandle.signalCode === null
        ) {
          processHandle.kill('SIGKILL');
          await new Promise((resolve) => processHandle.once('exit', resolve));
        }
        await fs.rm(directory, { recursive: true, force: true });
      });
      await new Promise((resolve) => child.stdout.on('data', resolve));
      child.kill();
      await child.exited;
      assert.equal(await fs.readFile(marker, 'utf8'), 'flushed');
      assert.equal(processHandle.exitCode, 0);
      assert.equal(child.exitCode, 0);
    }
  );
});

describe(
  'startDetachedProcess',
  {
    timeout: 10000,
    // Both the original 1.4.0 and 2.0.2 runner disable Windows detachment.
    skip:
      process.platform === 'win32' &&
      'Command Stream only creates detached process groups on Unix',
  },
  () => {
    it('lets the launcher exit while the detached child survives', async (t) => {
      const directory = await fs.mkdtemp(
        path.join(tmpdir(), 'bc-detached-164-')
      );
      const marker = path.join(directory, 'survived');
      let pid;
      const launcher = startProcess(node, [
        repoPath('experiments', 'issue-164', 'detached-launcher.mjs'),
        marker,
      ]);
      t.after(async () => {
        launcher.kill();
        if (pid) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch (error) {
            if (error.code !== 'ESRCH') {
              throw error;
            }
          }
        }
        await fs.rm(directory, { recursive: true, force: true });
      });
      let output = '';
      launcher.stdout.on('data', (chunk) => {
        output += chunk;
        pid = Number(output.trim());
      });
      assert.equal(await launcher.exited, 0, launcher.stderrTail);
      assert.ok(pid > 0);
      await assert.rejects(fs.readFile(marker), { code: 'ENOENT' });
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
      assert.fail('detached child did not survive the launcher exit');
    });
  }
);
