/**
 * The gate that makes a cancelled job visible.
 *
 * GitHub reports a job killed by its `timeout-minutes` as *cancelled*, not
 * *failed*, and a run whose only casualty is a cancelled job is filed under
 * `cancelled` as well - run 24045269874 of this repository is one such run on
 * `main`. scripts/check-pipeline-status.sh is the only thing that looks at
 * that, so these tests pin the four readings it has to get right: a failure is
 * always an error, a cancellation off the default branch is a warning, a
 * cancellation on the default branch is an error unless a newer run has already
 * taken over the branch head.
 *
 * See docs/CI-TIMEOUT-BUDGETS.md.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import {
  BASH_AVAILABLE,
  REPO_ROOT,
  repoPath,
  runBashScript,
} from '../../helpers/repo.js';

const SCRIPT = repoPath('scripts/check-pipeline-status.sh');

function runGate(needs, env = {}, options = {}) {
  return runBashScript(SCRIPT, [], {
    cwd: options.cwd,
    env: { NEEDS_JSON: JSON.stringify(needs), ...env },
  });
}

function results(map) {
  return Object.fromEntries(
    Object.entries(map).map(([job, result]) => [job, { result }])
  );
}

describe('check-pipeline-status.sh', { skip: !BASH_AVAILABLE }, () => {
  it('passes when every job succeeded or was legitimately skipped', () => {
    const { status, output } = runGate(
      results({ lint: 'success', release: 'skipped' }),
      { IS_MAIN: 'true', RUN_SHA: 'abc', BRANCH_HEAD_SHA: 'abc' }
    );

    assert.equal(status, 0);
    assert.match(
      output,
      /All required jobs succeeded or were legitimately skipped/
    );
  });

  it('fails on a failed job and names it', () => {
    const { status, output } = runGate(
      results({ lint: 'failure', test: 'success' }),
      { IS_MAIN: 'true', RUN_SHA: 'abc', BRANCH_HEAD_SHA: 'abc' }
    );

    assert.equal(status, 1);
    assert.match(output, /::error::Pipeline failed\. Failing jobs: lint/);
  });

  it('only warns about a cancellation off the default branch', () => {
    const { status, output } = runGate(results({ test: 'cancelled' }), {
      IS_MAIN: 'false',
      RUN_SHA: 'abc',
      BRANCH_HEAD_SHA: 'abc',
    });

    assert.equal(status, 0);
    assert.match(output, /::warning::Cancelled jobs: test/);
  });

  it('fails on a cancellation on the default branch head', () => {
    const { status, output } = runGate(results({ test: 'cancelled' }), {
      IS_MAIN: 'true',
      RUN_SHA: 'abc',
      BRANCH_HEAD_SHA: 'abc',
    });

    assert.equal(status, 1);
    assert.match(output, /::error::Pipeline has cancelled jobs on main: test/);
  });

  it('only warns when a newer commit already superseded the run', () => {
    const { status, output } = runGate(results({ test: 'cancelled' }), {
      IS_MAIN: 'true',
      RUN_SHA: 'abc',
      BRANCH_HEAD_SHA: 'def',
    });

    assert.equal(status, 0);
    assert.match(output, /This run tests abc; main is at def/);
    assert.match(output, /::warning::Cancelled jobs: test/);
  });

  it('fails rather than guesses when the branch head cannot be resolved', () => {
    // A missed supersede costs one noisy warning; a missed overrun on main
    // costs a silent failure, so the unresolvable case has to be the loud one.
    const directory = mkdtempSync(path.join(tmpdir(), 'pipeline-status-'));

    try {
      const { status, output } = runGate(
        results({ test: 'cancelled' }),
        { IS_MAIN: 'true', RUN_SHA: 'abc', BRANCH_HEAD_SHA: '' },
        { cwd: directory }
      );

      assert.equal(status, 1);
      assert.match(output, /assuming it is current/);
      assert.match(output, /::error::Pipeline has cancelled jobs on main/);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('refuses to run without the job results', () => {
    const result = spawnSync('bash', [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, NEEDS_JSON: '' },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /NEEDS_JSON is required/);
  });
});
