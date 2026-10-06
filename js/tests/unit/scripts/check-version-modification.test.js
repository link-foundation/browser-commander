import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  checkVersionModification,
  findManualVersionChanges,
} from '../../../../scripts/check-version-modification.mjs';
import { repoPath } from '../../helpers/repo.js';

const SCRIPT = repoPath('scripts/check-version-modification.mjs');

// The real implementation shells out to git; injecting the diff keeps these
// cases independent of the branch the suite happens to run on.
function stubDiff(diffsByPath) {
  return (_baseRef, path) => diffsByPath[path] ?? '';
}

describe('check-version-modification', () => {
  it('reports nothing when no manifest changed', () => {
    assert.deepEqual(findManualVersionChanges('main', stubDiff({})), []);
  });

  it('detects a hand-edited package.json version', () => {
    const diff = stubDiff({
      'js/package.json': [
        '--- a/js/package.json',
        '+++ b/js/package.json',
        '-  "version": "0.16.0",',
        '+  "version": "0.17.0",',
      ].join('\n'),
    });

    assert.deepEqual(findManualVersionChanges('main', diff), [
      'js/package.json',
    ]);
  });

  it('detects hand-edited pyproject and Cargo versions together', () => {
    const diff = stubDiff({
      'python/pyproject.toml': '+version = "0.5.4"',
      'rust/Cargo.toml': '+version = "0.9.1"',
    });

    assert.deepEqual(findManualVersionChanges('main', diff), [
      'python/pyproject.toml',
      'rust/Cargo.toml',
    ]);
  });

  it('ignores a non-numeric version key', () => {
    // pyproject declares `version = "literal: pyproject.toml: project.version"`
    // for its release tooling; that is not a version bump.
    const diff = stubDiff({
      'python/pyproject.toml':
        '+version = "literal: pyproject.toml: project.version"',
    });

    assert.deepEqual(findManualVersionChanges('main', diff), []);
  });

  it('ignores an unrelated edit to a manifest', () => {
    const diff = stubDiff({
      'js/package.json': '+  "description": "A new description",',
    });

    assert.deepEqual(findManualVersionChanges('main', diff), []);
  });

  it('ignores a removed version line', () => {
    const diff = stubDiff({
      'js/package.json': '-  "version": "0.16.0",',
    });

    assert.deepEqual(findManualVersionChanges('main', diff), []);
  });
});

describe('check-version-modification when git cannot diff', () => {
  // Issue #128 (link-foundation/rust-ai-driven-development-pipeline-template
  // #174): a failed `git diff` used to read as "nothing changed", so a missing
  // base ref turned the check into a pass.
  function failingDiff() {
    throw new Error("fatal: ambiguous argument 'origin/main...HEAD'");
  }

  it('fails rather than reporting no change', () => {
    assert.throws(
      () => findManualVersionChanges('main', failingDiff),
      /Could not diff js\/package\.json against origin\/main/
    );
  });

  it('fetches the base once and retries before giving up', () => {
    let fetched = 0;
    const diff = (_baseRef, path) => {
      if (fetched === 0) {
        failingDiff();
      }
      return path === 'rust/Cargo.toml' ? '+version = "0.9.1"' : '';
    };

    assert.deepEqual(
      checkVersionModification('main', {
        diff,
        fetchBase: () => {
          fetched += 1;
        },
      }),
      ['rust/Cargo.toml']
    );
    assert.equal(fetched, 1);
  });

  it('reports the failure when the retry fails too', () => {
    let fetched = 0;

    assert.throws(
      () =>
        checkVersionModification('main', {
          diff: failingDiff,
          fetchBase: () => {
            fetched += 1;
          },
        }),
      /Could not diff/
    );
    assert.equal(fetched, 1);
  });

  it('exits 1 with an error annotation from the command line', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'version-check-'));

    try {
      // A repository with no origin: the base ref cannot exist, and neither
      // can the fetch that would bring it in.
      spawnSync('git', ['init', '-q', directory]);
      spawnSync(
        'git',
        [
          '-C',
          directory,
          '-c',
          'user.name=t',
          '-c',
          'user.email=t@example.com',
          'commit',
          '-q',
          '--allow-empty',
          '-m',
          'init',
        ],
        { encoding: 'utf8' }
      );

      const result = spawnSync(process.execPath, [SCRIPT], {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_BASE_REF: 'main',
          GITHUB_HEAD_REF: 'feature',
        },
      });

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /::error::Could not diff/);
      assert.doesNotMatch(result.stdout, /No manual version changes/);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
