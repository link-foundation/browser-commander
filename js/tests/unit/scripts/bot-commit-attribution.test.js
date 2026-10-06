/**
 * CI commits use the bot's documented no-reply address (issue #128).
 *
 * GitHub documents a user's no-reply address as
 * `{user.id}+{user.login}@users.noreply.github.com`, and the actions/checkout
 * README configures `41898282+github-actions[bot]@users.noreply.github.com`
 * for commits pushed from a workflow. The three release paths here used the
 * legacy `github-actions[bot]@users.noreply.github.com` instead.
 *
 * Checked on 2026-10-06: GitHub still links the legacy address to the bot
 * (the commits API returns `author.login: github-actions[bot]` for release
 * commits 9f8a552, cca988f, fda33e7 and d159aeb), so no release was ever
 * unattributed here. The JS pipeline template switched for that reason
 * (link-foundation/js-ai-driven-development-pipeline-template#144), which
 * this repository could not reproduce. The test pins the documented form so
 * the three packages agree with each other and with the template, without
 * relying on GitHub continuing to resolve the undocumented one.
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
