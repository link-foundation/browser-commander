import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findManualVersionChanges } from '../../../../scripts/check-version-modification.mjs';

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
