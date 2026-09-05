/**
 * Guard for the lockfile half of RC-C.
 *
 * `rust/scripts/version-and-commit.mjs` writes the new version into
 * Cargo.toml. Cargo.lock carries the workspace member's own version too, so a
 * bump that touches only the manifest leaves the two disagreeing, and every
 * job that builds the release commit with `cargo build --locked` fails with
 * "the lock file needs to be updated but --locked was passed".
 *
 * The drift was invisible while RC-C was live: the release commit was never
 * pushed, so main kept a Cargo.toml and a Cargo.lock that still agreed.
 * Fixing RC-C is what makes this reachable.
 *
 * Analysis: dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-C
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Read the version of a named package out of a Cargo.lock.
 *
 * The line separator is `\r?\n` because a Windows runner checks the file out
 * with CRLF: `git config core.autocrlf` is `true` on GitHub's windows-latest
 * image, so a pattern anchored on a bare `\n` matches nothing there and the
 * lookup silently returns `undefined` -- a guard that passes on two operating
 * systems and fails on the third for a reason that has nothing to do with what
 * it guards.
 *
 * @param {string} lock
 * @param {string} name
 * @returns {string | undefined}
 */
function lockedVersion(lock, name) {
  const pattern = new RegExp(
    `\\[\\[package\\]\\]\\r?\\nname = "${name}"\\r?\\nversion = "([^"]+)"`
  );
  return pattern.exec(lock)?.[1];
}

describe('Cargo.lock stays in step with the release bump', () => {
  const cargoToml = readFileSync(join(repoRoot, 'rust/Cargo.toml'), 'utf8');
  const cargoLock = readFileSync(join(repoRoot, 'rust/Cargo.lock'), 'utf8');
  const script = readFileSync(
    join(repoRoot, 'rust/scripts/version-and-commit.mjs'),
    'utf8'
  );

  it('records the manifest version in the lockfile today', () => {
    const manifestVersion = /^\[package\][\s\S]*?^version = "([^"]+)"/m.exec(
      cargoToml
    )?.[1];
    assert.ok(manifestVersion, 'Cargo.toml has no [package] version');
    assert.equal(
      lockedVersion(cargoLock, 'browser-commander'),
      manifestVersion,
      'a build with --locked would refuse this tree'
    );
  });

  it('reads a lockfile that was checked out with CRLF line endings', () => {
    const crlf = cargoLock.replace(/\r?\n/g, '\r\n');
    assert.equal(
      lockedVersion(crlf, 'browser-commander'),
      lockedVersion(cargoLock, 'browser-commander'),
      'the same lockfile must read the same on a Windows checkout'
    );
  });

  it('refreshes the lockfile as part of the bump', () => {
    assert.match(
      script,
      /cargo update --workspace/,
      'bumping Cargo.toml without refreshing Cargo.lock breaks --locked builds'
    );
  });

  it('refreshes the lockfile after the manifest, not before', () => {
    const bump = script.indexOf('updateCargoToml(newVersion)');
    const refresh = script.indexOf('cargo update --workspace');
    assert.ok(bump > 0 && refresh > 0);
    assert.ok(
      bump < refresh,
      'refreshing before the bump would re-lock the old version'
    );
  });

  it('stages the lockfile in the release commit', () => {
    const add = /git add -A ([^`]+)`/.exec(script)?.[1] ?? '';
    assert.ok(
      add.split(/\s+/).includes('Cargo.lock'),
      `Cargo.lock is refreshed but never committed (staged: ${add.trim()})`
    );
  });

  it('is what the release job later builds with --locked', () => {
    // If the workflow stopped passing --locked the drift would go unnoticed
    // again, so the guard is only meaningful while this flag is there.
    const workflow = readFileSync(
      join(repoRoot, '.github/workflows/rust.yml'),
      'utf8'
    );
    assert.match(workflow, /cargo build --locked/);
  });
});
