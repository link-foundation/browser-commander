/**
 * The wrapper that gives a long step its own deadline.
 *
 * A job killed by `timeout-minutes` is reported as cancelled, which is not a
 * failure; a step that owns its budget exits non-zero instead, so the overrun
 * turns a check red and names the deadline it blew. These tests pin the
 * properties the workflows depend on: the command's own exit status is passed
 * through untouched, an overrun exits 124 with an error annotation, the whole
 * process tree is killed rather than just the direct child (with SIGKILL when
 * SIGTERM is ignored), and a surviving child cannot hold the caller's output
 * pipe open (issue #128, ported from the link-foundation pipeline templates).
 *
 * See docs/CI-TIMEOUT-BUDGETS.md.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { BASH_AVAILABLE, repoPath, runBashScript } from '../../helpers/repo.js';

const SCRIPT = repoPath('scripts/run-with-budget-warning.sh');

// pgrep/pkill and POSIX process groups: the survivor checks need both.
const POSIX = BASH_AVAILABLE && process.platform !== 'win32';

/** A sleep duration nothing else uses, so pgrep can find exactly this one. */
function markerSeconds(base) {
  return base + (process.pid % 1000);
}

function survivorsOf(pattern) {
  return spawnSync('pgrep', ['-f', pattern], {
    encoding: 'utf8',
  }).stdout.trim();
}

// Quiet unless a test asks otherwise, even when this suite itself runs in a
// job re-run with debug logging.
const QUIET = {
  BUDGET_GRACE_SECONDS: '1',
  BUDGET_VERBOSE: '',
  RUNNER_DEBUG: '',
};

function runWrapper(args, env = {}) {
  return runBashScript(SCRIPT, args, { env: { ...QUIET, ...env } });
}

/**
 * Run the wrapper without letting a process it failed to stop hang the test.
 * A survivor that still holds the output pipe would keep spawnSync waiting
 * forever, so give up after a deadline and kill whatever matches `marker`.
 */
async function runWrapperBounded(args, env, marker, timeoutMs = 20_000) {
  const child = spawn('bash', [SCRIPT, ...args], {
    env: { ...process.env, ...QUIET, ...env },
  });
  let stdout = '';
  let output = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });

  let timer;
  try {
    return await Promise.race([
      new Promise((resolve) =>
        child.on('close', (status) => resolve({ status, stdout, output }))
      ),
      new Promise((resolve) => {
        timer = setTimeout(
          () => resolve({ status: 'timed out', stdout, output }),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    spawnSync('pkill', ['-KILL', '-f', marker]);
    child.kill('SIGKILL');
  }
}

describe('run-with-budget-warning.sh', { skip: !BASH_AVAILABLE }, () => {
  it('passes a successful command through', () => {
    const { status, output } = runWrapper(['5', 'quick step', 'true']);

    assert.equal(status, 0);
    assert.match(
      output,
      /quick step finished in \d+s of its 5s budget \(exit 0\)/
    );
  });

  it("passes a failing command's own exit status through", () => {
    const { status } = runWrapper([
      '5',
      'failing step',
      'bash',
      '-c',
      'exit 7',
    ]);

    assert.equal(status, 7);
  });

  it('exits 124 and annotates the overrun', () => {
    const { status, output } = runWrapper(['1', 'slow step', 'sleep', '30']);

    assert.equal(status, 124);
    assert.match(
      output,
      /::error title=slow step exceeded its execution budget::/
    );
  });

  it('kills the whole process group, not just the direct child', async () => {
    // Test runners spawn workers; killing only the direct child leaves orphans
    // holding the runner, which is why timeout(1) is not sufficient here. The
    // worker is watched through the file it writes rather than through
    // `kill -0`, which also succeeds for a killed-but-unreaped zombie.
    const directory = mkdtempSync(path.join(tmpdir(), 'budget-wrapper-'));
    const tickFile = path.join(directory, 'ticks');

    try {
      const { status } = runWrapper([
        '1',
        'step with a worker',
        'bash',
        '-c',
        `while true; do echo tick >> ${JSON.stringify(tickFile)}; sleep 0.2; done & wait`,
      ]);

      assert.equal(status, 124);

      const ticksAtTermination = readFileSync(tickFile, 'utf8').length;

      assert.ok(ticksAtTermination > 0, 'the worker never started');

      await new Promise((resolve) => setTimeout(resolve, 1500));

      assert.equal(
        readFileSync(tickFile, 'utf8').length,
        ticksAtTermination,
        'the worker outlived the budget termination'
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('warns before the budget expires', () => {
    const { status, output } = runWrapper(['10', 'warned step', 'sleep', '2'], {
      BUDGET_WARN_PERCENT: '10',
    });

    assert.equal(status, 0);
    assert.match(
      output,
      /::warning title=warned step is approaching its execution budget::/
    );
  });

  it('rejects a budget that is not a positive number of seconds', () => {
    assert.equal(runWrapper(['soon', 'bad budget', 'true']).status, 2);
    assert.equal(runWrapper(['0', 'bad budget', 'true']).status, 2);
    assert.equal(runWrapper(['5']).status, 2);
  });

  it(
    'escalates to SIGKILL when the command ignores SIGTERM',
    { skip: !POSIX },
    async () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'budget-child-'));
      const child = path.join(directory, 'ignore-term.sh');
      // Stays in bash so the trap keeps applying; an exec would drop it. The
      // sleep keeps the loop idle instead of spinning a core.
      writeFileSync(
        child,
        [
          '#!/usr/bin/env bash',
          `trap 'echo "child ignored SIGTERM"' TERM`,
          'while :; do sleep 0.2; done',
          '',
        ].join('\n')
      );
      chmodSync(child, 0o755);

      try {
        const { status, output } = await runWrapperBounded(
          ['1', 'stubborn step', child],
          {},
          child
        );

        assert.equal(status, 124);
        assert.match(
          output,
          /stubborn step ignored SIGTERM after 1s; sending SIGKILL\./
        );
        assert.equal(survivorsOf(child), '');
      } finally {
        rmSync(directory, { force: true, recursive: true });
      }
    }
  );

  it(
    'does not let a surviving child hold the output pipe open',
    { skip: !POSIX },
    async () => {
      // The child inherits the wrapper's captured files, not the caller's
      // pipe, so a caller reading to EOF is not held up by it.
      const marker = `^sleep ${markerSeconds(800000)}$`;
      const { status, stdout } = await runWrapperBounded(
        [
          '30',
          'detached worker',
          'bash',
          '-c',
          `sleep ${markerSeconds(800000)} & echo root-finished`,
        ],
        { BUDGET_POLL_SECONDS: '0.05' },
        marker
      );

      assert.equal(status, 0, 'the wrapper output pipe stayed open');
      assert.match(stdout, /root-finished/);
      assert.match(stdout, /detached worker finished/);
    }
  );

  it('keeps its control state when the command cleans TMPDIR', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'budget-state-'));
    const commandTmp = path.join(root, 'command-tmp');
    const runnerTmp = path.join(root, 'runner-tmp');
    mkdirSync(commandTmp);
    mkdirSync(runnerTmp);

    try {
      const { status, output } = runWrapper(
        [
          '10',
          'tmp-cleaning step',
          'bash',
          '-c',
          'rm -rf "${TMPDIR:?}"/*; echo command-completed',
        ],
        { TMPDIR: commandTmp, RUNNER_TEMP: runnerTmp }
      );

      assert.equal(status, 0);
      assert.match(output, /command-completed/);
      assert.doesNotMatch(output, /No such file or directory/);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('enforces the budget on a fractional poll interval', () => {
    const { status, output } = runWrapper(
      ['1', 'fractional poll', 'sleep', '30'],
      { BUDGET_POLL_SECONDS: '0.5' }
    );

    assert.equal(status, 124);
    assert.doesNotMatch(output, /invalid arithmetic operator/);
  });

  it('rejects a poll interval that is not a number', () => {
    const { status, output } = runWrapper(['5', 'bad poll', 'true'], {
      BUDGET_POLL_SECONDS: 'soon',
    });

    assert.equal(status, 2);
    assert.match(output, /BUDGET_POLL_SECONDS must be a positive number/);
  });

  it(
    'lists what is still running at an overrun only when asked to',
    { skip: !POSIX },
    () => {
      // Issue #128: a Windows `cargo test --doc` step printed nothing for its
      // whole budget, leaving no trace of what it was stuck on. The snapshot
      // is opt-in (BUDGET_VERBOSE, or GitHub's "debug logging" re-run, which
      // sets RUNNER_DEBUG) so ordinary logs stay as they were.
      const seconds = markerSeconds(700000);
      const args = ['1', 'stalled step', 'sleep', String(seconds)];

      const quiet = runWrapper(args);
      assert.equal(quiet.status, 124);
      assert.doesNotMatch(quiet.output, /\[budget\]/);

      for (const env of [{ BUDGET_VERBOSE: '1' }, { RUNNER_DEBUG: '1' }]) {
        const { status, output } = runWrapper(args, env);
        assert.equal(status, 124);
        assert.match(
          output,
          new RegExp(
            `\\[budget\\] still running at the overrun:\\n.*sleep ${seconds}`
          )
        );
      }
    }
  );
});
