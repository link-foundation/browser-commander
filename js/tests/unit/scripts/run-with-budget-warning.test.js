/**
 * The wrapper that gives a long step its own deadline.
 *
 * A job killed by `timeout-minutes` is reported as cancelled, which is not a
 * failure; a step that owns its budget exits non-zero instead, so the overrun
 * turns a check red and names the deadline it blew. These tests pin the three
 * properties the workflows depend on: the command's own exit status is passed
 * through untouched, an overrun exits 124 with an error annotation, and the
 * whole process tree is killed rather than just the direct child.
 *
 * See docs/CI-TIMEOUT-BUDGETS.md.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { BASH_AVAILABLE, repoPath, runBashScript } from '../../helpers/repo.js';

const SCRIPT = repoPath('scripts/run-with-budget-warning.sh');

function runWrapper(args, env = {}) {
  return runBashScript(SCRIPT, args, {
    env: { BUDGET_GRACE_SECONDS: '1', ...env },
  });
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
});
