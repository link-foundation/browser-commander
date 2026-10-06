/**
 * The gate that makes a cancelled job visible.
 *
 * GitHub reports a job killed by its `timeout-minutes` as *cancelled*, not
 * *failed*, and a run whose only casualty is a cancelled job is filed under
 * `cancelled` as well - run 24045269874 of this repository is one such run on
 * `main`. scripts/check-pipeline-status.sh is the only thing that looks at
 * that, so these tests pin the readings it has to get right: a failure is
 * always an error, and a cancellation is an error unless a newer commit has
 * overtaken the run *and* the cancelled job is one a newer run can cancel
 * (`cancel-in-progress: true`). Anything else - a job that queues instead, a
 * run still at the branch head, a value the gate cannot read - is a timeout or
 * a manual stop that nothing else will report.
 *
 * The gate used to warn about every cancellation off the default branch, so a
 * pull request whose test job hit `timeout-minutes` passed its gate (issue
 * #128), and it excused a cancelled release writer on a superseded `main` run
 * although `cancel-in-progress: false` means no newer run can cancel it.
 *
 * Hosted-runner failures can report an undocumented abandoned result; it and
 * other unexpected/missing results must fail on every branch.
 *
 * See docs/CI-TIMEOUT-BUDGETS.md.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';

import { readCancelInProgress } from '../../../../scripts/read-job-cancel-in-progress.mjs';
import {
  BASH_AVAILABLE,
  REPO_ROOT,
  readRepoText,
  repoPath,
  runBashScript,
} from '../../helpers/repo.js';

const SCRIPT = repoPath('scripts/check-pipeline-status.sh');

const FIXTURE_WORKFLOW = `name: Fixture

concurrency:
  group: fixture-\${{ github.ref }}
  cancel-in-progress: false

jobs:
  test:
    runs-on: ubuntu-24.04
    concurrency:
      group: \${{ github.workflow }}-\${{ github.ref }}-test
      cancel-in-progress: true # superseded runs stop here
    steps:
      - run: echo test

  release:
    runs-on: ubuntu-24.04
    concurrency:
      group: main-writer
      cancel-in-progress: false
    steps:
      - run: echo release

  dynamic:
    runs-on: ubuntu-24.04
    concurrency:
      group: dynamic
      cancel-in-progress: \${{ github.event_name == 'pull_request' }}
    steps:
      - run: echo dynamic

  inherits:
    runs-on: ubuntu-24.04
    steps:
      - run: echo inherits

  group-only:
    runs-on: ubuntu-24.04
    concurrency: just-a-group
    steps:
      - run: echo group
`;

function results(map) {
  return Object.fromEntries(
    Object.entries(map).map(([job, result]) => [job, { result }])
  );
}

describe('readCancelInProgress', () => {
  const policy = readCancelInProgress(FIXTURE_WORKFLOW, [
    'test',
    'release',
    'dynamic',
    'inherits',
    'group-only',
    'absent',
  ]);

  it('reads a literal job-level value, comments and all', () => {
    assert.equal(policy.get('test'), 'true');
    assert.equal(policy.get('release'), 'false');
  });

  it('reports an expression as unknown instead of guessing', () => {
    assert.equal(policy.get('dynamic'), 'unknown');
  });

  it('falls back to the workflow-level group, and to false for a bare group', () => {
    assert.equal(policy.get('inherits'), 'false');
    assert.equal(policy.get('group-only'), 'false');
  });

  it('says when the workflow has no such job', () => {
    assert.equal(policy.get('absent'), 'missing');
  });

  it('says when neither the job nor the workflow has a group', () => {
    const bare = 'name: Bare\non: push\njobs:\n  only:\n    runs-on: x\n';
    assert.equal(readCancelInProgress(bare, ['only']).get('only'), 'none');
  });
});

describe('check-pipeline-status.sh', { skip: !BASH_AVAILABLE }, () => {
  let directory;
  let workflowFile;

  before(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'pipeline-status-'));
    workflowFile = path.join(directory, 'fixture.yml');
    writeFileSync(workflowFile, FIXTURE_WORKFLOW);
  });

  after(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  // GITHUB_WORKFLOW_REF is set when this suite itself runs in Actions; blank
  // it so only what a test passes decides which workflow the gate reads.
  function runGate(needs, env = {}, options = {}) {
    return runBashScript(SCRIPT, [], {
      cwd: options.cwd,
      env: {
        GITHUB_WORKFLOW_REF: '',
        WORKFLOW_FILE: workflowFile,
        BRANCH_NAME: 'main',
        RUN_SHA: 'abc',
        BRANCH_HEAD_SHA: 'abc',
        NEEDS_JSON: JSON.stringify(needs),
        ...env,
      },
    });
  }

  const superseded = { BRANCH_HEAD_SHA: 'def' };

  it('passes when every job succeeded or was legitimately skipped', () => {
    const { status, output } = runGate(
      results({ lint: 'success', release: 'skipped' })
    );

    assert.equal(status, 0);
    assert.match(
      output,
      /All required jobs succeeded or were legitimately skipped/
    );
  });

  it('fails on a failed job and names it', () => {
    const { status, output } = runGate(
      results({ lint: 'failure', test: 'success' })
    );

    assert.equal(status, 1);
    assert.match(output, /::error::Pipeline failed\. Failing jobs: lint/);
  });

  for (const env of [{}, superseded]) {
    it(`fails on an abandoned runner job (branch head ${env.BRANCH_HEAD_SHA ?? 'abc'})`, () => {
      // Hosted-runner acquisition failure in run 37362314527 left the macOS
      // check cancelled, but GitHub sent "abandoned" to the needs context.
      const { status, output } = runGate(
        results({ lint: 'success', test: 'abandoned', release: 'skipped' }),
        env
      );

      assert.equal(status, 1);
      assert.match(output, /::error::Pipeline has unexpected job results/);
      assert.match(output, /test \(abandoned\)/);
      assert.doesNotMatch(output, /All required jobs succeeded/);
    });
  }

  for (const result of ['timed_out', null, undefined]) {
    it(`rejects an unexpected result of ${result}`, () => {
      const { status, output } = runGate(results({ test: result }));

      assert.equal(status, 1);
      assert.match(output, /::error::Pipeline has unexpected job results/);
      assert.match(output, /test \(/);
      assert.doesNotMatch(output, /All required jobs succeeded/);
    });
  }

  it('fails on a cancellation in a pull request run that nothing overtook', () => {
    // The old gate only warned off the default branch, so a pull request whose
    // test job hit timeout-minutes passed its gate.
    const { status, output } = runGate(results({ test: 'cancelled' }), {
      BRANCH_NAME: 'issue-128-feature',
    });

    assert.equal(status, 1);
    assert.match(output, /This run tests abc; issue-128-feature is at abc/);
    assert.match(
      output,
      /test: the run is still the head of issue-128-feature/
    );
    assert.match(output, /::error::Pipeline has cancelled jobs: test\./);
  });

  it('fails on a cancellation at the default branch head', () => {
    const { status, output } = runGate(results({ test: 'cancelled' }));

    assert.equal(status, 1);
    assert.match(output, /::error::Pipeline has cancelled jobs: test\./);
  });

  it('only warns when a newer commit overtook a job that cancels in progress', () => {
    const { status, output } = runGate(
      results({ test: 'cancelled' }),
      superseded
    );

    assert.equal(status, 0);
    assert.match(output, /This run tests abc; main is at def/);
    assert.match(output, /test: it sets cancel-in-progress: true/);
    assert.match(
      output,
      /::warning::Cancelled jobs in a superseded run: test\./
    );
    assert.doesNotMatch(output, /::error::/);
  });

  for (const [job, reason] of [
    ['release', /it sets cancel-in-progress: false, so a newer run queues/],
    ['dynamic', /cancel-in-progress is an expression or otherwise unreadable/],
    ['inherits', /it sets cancel-in-progress: false, so a newer run queues/],
    ['absent', /declares no job by that name/],
  ]) {
    it(`fails on a superseded run's cancelled ${job} job, which no supersede explains`, () => {
      const { status, output } = runGate(
        results({ test: 'cancelled', [job]: 'cancelled' }),
        superseded
      );

      assert.equal(status, 1);
      assert.match(output, reason);
      assert.match(
        output,
        /::warning::Cancelled jobs in a superseded run: test\./
      );
      assert.match(
        output,
        new RegExp(`::error::Pipeline has cancelled jobs: ${job}\\.`)
      );
    });
  }

  it('fails closed when it cannot tell which workflow it is gating', () => {
    const { status, output } = runGate(results({ test: 'cancelled' }), {
      ...superseded,
      WORKFLOW_FILE: '',
    });

    assert.equal(status, 1);
    assert.match(output, /could not identify its workflow/);
  });

  it('finds its workflow through GITHUB_WORKFLOW_REF, from the repository root', () => {
    // ci-policy.yml's `check` job cancels in progress; `pipeline-status` reads
    // it from the checkout whichever directory the step runs in.
    const { status, output } = runGate(
      results({ check: 'cancelled' }),
      {
        ...superseded,
        WORKFLOW_FILE: '',
        GITHUB_WORKFLOW_REF:
          'link-foundation/browser-commander/.github/workflows/ci-policy.yml@refs/pull/129/merge',
      },
      { cwd: directory }
    );

    assert.equal(status, 0, output);
    assert.match(output, /check: it sets cancel-in-progress: true/);
  });

  it('fails rather than guesses when the branch head cannot be resolved', () => {
    // A missed supersede costs one noisy warning; a missed overrun on main
    // costs a silent failure, so the unresolvable case has to be the loud one.
    const { status, output } = runGate(
      results({ test: 'cancelled' }),
      { BRANCH_HEAD_SHA: '', GIT_REMOTE: 'no-such-remote' },
      { cwd: directory }
    );

    assert.equal(status, 1);
    assert.match(output, /assuming it is current/);
    assert.match(output, /::error::Pipeline has cancelled jobs: test\./);
  });

  it('prints the classification trace only when asked', () => {
    const quiet = runGate(results({ test: 'cancelled' }), superseded);
    const verbose = runGate(results({ test: 'cancelled' }), {
      ...superseded,
      PIPELINE_STATUS_VERBOSE: '1',
    });

    assert.doesNotMatch(quiet.output, /\[pipeline-status\]/);
    assert.match(
      verbose.output,
      /\[pipeline-status\] cancelled test: cancel-in-progress=true, superseded=yes/
    );
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

describe('workflows that run the gate', () => {
  const workflows = readdirSync(repoPath('.github/workflows'))
    .filter((name) => name.endsWith('.yml'))
    .map((name) => ({ name, source: readRepoText('.github/workflows', name) }))
    .filter(({ source }) => source.includes('check-pipeline-status.sh'));

  it('exist', () => {
    assert.ok(workflows.length > 0);
  });

  for (const { name, source } of workflows) {
    it(`${name} tells the gate which commit and branch the run tests`, () => {
      // A pull request run's github.sha is a merge commit no branch points at,
      // and github.ref_name is "129/merge"; the head commit and head branch are
      // what a newer push moves.
      assert.match(
        source,
        /RUN_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/
      );
      assert.match(
        source,
        /BRANCH_NAME: \$\{\{ github\.head_ref \|\| github\.ref_name \}\}/
      );
      assert.doesNotMatch(source, /IS_MAIN:/);
    });

    it(`${name} gives every job a cancel-in-progress the gate can read`, () => {
      const jobsBlock = source.slice(source.search(/^jobs:\s*$/m));
      const jobs = [
        ...jobsBlock.matchAll(/^ {2}([A-Za-z_][\w.-]*):\s*$/gm),
      ].map((match) => match[1]);
      const unreadable = [...readCancelInProgress(source, jobs)]
        .filter(([, value]) => !['true', 'false'].includes(value))
        .map(([job, value]) => `${job}=${value}`);
      assert.deepEqual(unreadable, []);
    });
  }
});
