/**
 * Guard for RC-1 and RC-3.
 *
 * RC-1: the release jobs are serialised by a concurrency group but each one
 * checks out `github.sha`, so every writer after the first holds a tree one
 * commit behind main and its push is rejected. Nothing rebased and retried.
 *
 * RC-3: a retry rebases, which rewrites the release commit. A tag created
 * before the push would keep pointing at the pre-rebase commit and be
 * reachable from no branch -- reproduced as case 2 of
 * experiments/ci-repro/repro-release-push-race.sh. So the release scripts must
 * tag only after the push has succeeded.
 *
 * Analysis: dev/log/issues/85/pulls/86/analysis/root-causes.md
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  DEFAULT_ATTEMPTS,
  pushWithRebaseRetry,
  resolveCurrentBranch,
} from '../../../../scripts/push-with-rebase-retry.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** A rejection shaped like the one `command-stream` produces for git. */
function rejection(stderr) {
  return Object.assign(new Error('Command failed with exit code 1'), {
    code: 1,
    stdout: '',
    stderr,
  });
}

const RACE = ' ! [rejected]        HEAD -> main (non-fast-forward)\n';
const RULE = [
  'remote: error: GH013: Repository rule violations found for refs/heads/main.',
  'remote: - Changes must be made through a pull request.',
].join('\n');

/**
 * Build a fake git that fails the first `failures` pushes with `stderr`, then
 * succeeds, recording every argv it was handed.
 */
function fakeGit({ failures = 0, stderr = RACE, stdout = '' } = {}) {
  const calls = [];
  let pushes = 0;
  const git = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'push') {
      pushes++;
      if (pushes <= failures) {
        throw rejection(stderr);
      }
    }
    return { stdout, stderr: '', code: 0 };
  };
  git.calls = calls;
  return git;
}

/** Collect log lines instead of printing them. */
function fakeLogger() {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
}

const silent = () => {};

describe('pushWithRebaseRetry', () => {
  it('pushes once when nothing else has written to the branch', async () => {
    const git = fakeGit();
    const result = await pushWithRebaseRetry({
      git,
      branch: 'main',
      logger: fakeLogger(),
      debugFn: silent,
    });

    assert.deepEqual(result, { pushed: true, via: 'direct', attempts: 1 });
    assert.deepEqual(git.calls, ['push origin HEAD:main']);
  });

  it('rebases and retries after losing the race, as in run 33998729944', async () => {
    const git = fakeGit({ failures: 1 });
    const logger = fakeLogger();

    const result = await pushWithRebaseRetry({
      git,
      branch: 'main',
      logger,
      debugFn: silent,
    });

    assert.deepEqual(result, { pushed: true, via: 'rebase', attempts: 2 });
    assert.deepEqual(git.calls, [
      'push origin HEAD:main',
      'pull --rebase origin main',
      'push origin HEAD:main',
    ]);
    assert.ok(
      logger.lines.some((line) => line.startsWith('::warning::')),
      'a recovered race must still be visible in the log'
    );
  });

  it('does not retry a repository-rule rejection', async () => {
    // Rebasing cannot satisfy a ruleset. Retrying it doubles the time the job
    // takes to die and leaves a log blaming a race that never happened.
    const git = fakeGit({ failures: DEFAULT_ATTEMPTS, stderr: RULE });
    const logger = fakeLogger();

    await assert.rejects(
      pushWithRebaseRetry({ git, branch: 'main', logger, debugFn: silent })
    );

    assert.deepEqual(git.calls, ['push origin HEAD:main']);
    assert.ok(
      logger.lines.some(
        (line) => line.startsWith('::error::') && line.includes('GH006/GH013')
      ),
      'the log must name the real cause'
    );
  });

  it('does not retry a failure a rebase cannot fix', async () => {
    const git = fakeGit({
      failures: DEFAULT_ATTEMPTS,
      stderr: 'fatal: could not read Username for https://github.com',
    });

    await assert.rejects(
      pushWithRebaseRetry({
        git,
        branch: 'main',
        logger: fakeLogger(),
        debugFn: silent,
      })
    );
    assert.deepEqual(git.calls, ['push origin HEAD:main']);
  });

  it('gives up after the configured number of attempts', async () => {
    const git = fakeGit({ failures: 99 });

    await assert.rejects(
      pushWithRebaseRetry({
        git,
        branch: 'main',
        attempts: 3,
        logger: fakeLogger(),
        debugFn: silent,
      })
    );

    const pushes = git.calls.filter((call) => call.startsWith('push'));
    assert.equal(pushes.length, 3, 'exactly `attempts` pushes, no more');
  });

  it('pushes the branch it is told to, not always main', async () => {
    const git = fakeGit();
    await pushWithRebaseRetry({
      git,
      remote: 'upstream',
      branch: 'release',
      logger: fakeLogger(),
      debugFn: silent,
    });
    assert.deepEqual(git.calls, ['push upstream HEAD:release']);
  });

  it('stays silent on the debug channel unless tracing is switched on', async () => {
    // The verbose mode has to default to off: a release log is read by people
    // looking for the one line that matters.
    const traced = [];
    const git = fakeGit({ failures: 1 });
    await pushWithRebaseRetry({
      git,
      branch: 'main',
      logger: fakeLogger(),
      debugFn: (...parts) => traced.push(parts.join(' ')),
    });
    assert.ok(traced.length > 0, 'the helper must offer tracing to inject');

    const quiet = [];
    const { debugWith } = await import('../../../../scripts/debug-print.mjs');
    await pushWithRebaseRetry({
      git: fakeGit(),
      branch: 'main',
      logger: fakeLogger(),
      debugFn: (...parts) =>
        debugWith({ env: {}, log: (l) => quiet.push(l) }, ...parts),
    });
    assert.deepEqual(quiet, [], 'debug output must be off by default');
  });
});

describe('resolveCurrentBranch', () => {
  it('reads the branch instead of assuming main', async () => {
    // The Rust release used a bare `git push`, which follows the current
    // branch's upstream; a hard-coded HEAD:main would change behaviour for a
    // workflow_dispatch run started from another branch.
    const git = fakeGit({ stdout: 'release-2.x\n' });
    assert.equal(await resolveCurrentBranch(git), 'release-2.x');
    assert.deepEqual(git.calls, ['rev-parse --abbrev-ref HEAD']);
  });

  it('falls back to HEAD when git says nothing', async () => {
    assert.equal(
      await resolveCurrentBranch(fakeGit({ stdout: '  \n' })),
      'HEAD'
    );
  });
});

describe('release scripts tag only after the push (RC-3)', () => {
  const releaseScripts = [
    'rust/scripts/version-and-commit.mjs',
    'js/scripts/version-and-commit.mjs',
  ];

  for (const relativePath of releaseScripts) {
    it(`${relativePath} never leaves an orphaned tag`, () => {
      const source = readFileSync(join(repoRoot, relativePath), 'utf8');
      const tagIndex = source.indexOf('git tag -a');
      if (tagIndex === -1) {
        return; // This script does not tag; nothing to order.
      }
      const pushIndex = source.indexOf('pushWithRebaseRetry({');
      assert.notEqual(
        pushIndex,
        -1,
        `${relativePath} must push through pushWithRebaseRetry`
      );
      assert.ok(
        pushIndex < tagIndex,
        `${relativePath} creates a tag before pushing; a rebase retry would ` +
          'rewrite the commit and orphan that tag'
      );
    });
  }

  it('no release script pushes with the blanket --tags', () => {
    // `git push --tags` also pushes every unrelated local tag the runner
    // happens to have fetched.
    for (const relativePath of releaseScripts) {
      const source = readFileSync(join(repoRoot, relativePath), 'utf8');
      assert.ok(
        !source.includes('git push --tags'),
        `${relativePath} must push its release tag by name`
      );
    }
  });
});

describe('every release push site uses the shared helper', () => {
  // The fix has to be applied everywhere: a single un-migrated push site
  // reproduces the original failure the next time two releases run.
  it('leaves no raw push to a shared branch behind', () => {
    const sites = [
      'js/scripts/version-and-commit.mjs',
      'rust/scripts/version-and-commit.mjs',
    ];
    for (const relativePath of sites) {
      const source = readFileSync(join(repoRoot, relativePath), 'utf8');
      for (const raw of [
        'git push`',
        'git push origin main`',
        'git push --tags`',
        'git push origin HEAD:main`',
      ]) {
        assert.ok(
          !source.includes(raw),
          `${relativePath} still contains a raw \`${raw}\``
        );
      }
      assert.ok(
        source.includes('pushWithRebaseRetry'),
        `${relativePath} must push through the shared helper`
      );
    }
  });
});
