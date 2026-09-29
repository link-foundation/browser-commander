import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CommandError,
  runCommand,
  startProcess,
} from '../../../src/utilities/subprocess.js';

const node = process.execPath;

describe('runCommand', () => {
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
});

describe('startProcess', () => {
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
});
