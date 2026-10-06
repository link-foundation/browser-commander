/**
 * Release commits must be attributed to the github-actions[bot] account
 * (issue #128).
 *
 * GitHub links a commit to the bot only through the numeric-prefixed no-reply
 * address. `github-actions[bot]@users.noreply.github.com` matches no account,
 * so the release commits of all three packages showed up as unattributed, and
 * a ruleset with `require_extra_approval_for_unattributed_changes` would hold
 * every automated release for a manual approval. The JS pipeline template
 * switched to the prefixed address for the same reason.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { REPO_ROOT, repoPath } from '../../helpers/repo.js';

const BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com';
const UNPREFIXED = 'github-actions[bot]@users.noreply.github.com';

// Every place that configures the commit author for CI, per language.
const ROOTS = [
  '.github/workflows',
  'scripts',
  'js/scripts',
  'python/scripts',
  'rust/scripts',
];

// Tracked files only: a local __pycache__ holds stale copies of the scripts.
function trackedFiles(roots) {
  return execFileSync('git', ['ls-files', '-z', '--', ...roots], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}

describe('github-actions[bot] commit attribution', () => {
  const files = trackedFiles(ROOTS);

  it('configures the prefixed bot e-mail somewhere', () => {
    assert.ok(
      files.some((file) =>
        readFileSync(repoPath(file), 'utf8').includes(BOT_EMAIL)
      ),
      `no file configures ${BOT_EMAIL}`
    );
  });

  it('never configures the unprefixed bot e-mail', () => {
    const offenders = files.filter((file) =>
      readFileSync(repoPath(file), 'utf8')
        .split(BOT_EMAIL)
        .join('')
        .includes(UNPREFIXED)
    );
    assert.deepEqual(offenders, []);
  });
});
