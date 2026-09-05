/**
 * Guard for RC-I: collecting the changelog before the version bump.
 *
 * Both manual-release jobs used to collect fragments in a workflow step that
 * ran ahead of the bump, and both named the section wrongly as a result:
 *
 *   rust.yml    `node scripts/collect-changelog.mjs` reads the version out of
 *               Cargo.toml, which at that point still held the version that
 *               was already released, so the notes were filed under it and
 *               the version being released got none.
 *   python.yml  `scriv collect --version "$BUMP_TYPE"`. `--version` names the
 *               new changelog section rather than selecting a bump, so a
 *               release wrote a section titled "patch".
 *
 * Either way the release notes went missing: create-github-release looks for
 * the version it is releasing and falls back to a bare "Release <version>".
 *
 * Collection now happens inside the version-and-commit scripts, after the
 * bump has computed the version. These assertions are on the workflows,
 * because that is where the ordering lived.
 *
 * Analysis: dev/log/issues/83/pulls/84/analysis/root-causes.md
 * Reproduction: experiments/scriv-collect-version/run.sh
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * Read a workflow with its comment lines removed.
 *
 * The comments explain the very mistakes these assertions look for, so
 * matching against the raw file would find the explanation and report the bug
 * as still present.
 * @param {string} name
 * @returns {string}
 */
function workflow(name) {
  return readFileSync(join(repoRoot, '.github/workflows', name), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

describe('changelog fragments are collected after the version bump', () => {
  it('never passes a bump type where a version name is expected', () => {
    // `scriv collect --version` is documented as "The version name to use for
    // this entry", so "$BUMP_TYPE" lands in the changelog verbatim.
    assert.doesNotMatch(
      workflow('python.yml'),
      /scriv collect --version "\$BUMP_TYPE"/,
      'scriv would head the release section with the word "patch"'
    );
  });

  it('has no workflow step that collects ahead of the bump', () => {
    for (const [name, collector] of [
      ['rust.yml', 'collect-changelog.mjs'],
      ['python.yml', 'scriv collect'],
    ]) {
      const content = workflow(name);
      const collect = content.indexOf(collector);
      if (collect < 0) {
        continue;
      }
      const bump = content.indexOf('name: Version and commit');
      assert.ok(
        bump < 0 || collect > bump,
        `${name} collects the changelog before the bump names the version`
      );
    }
  });

  it('collects inside the scripts that know the new version', () => {
    const rust = readFileSync(
      join(repoRoot, 'rust/scripts/version-and-commit.mjs'),
      'utf8'
    );
    assert.match(rust, /updateChangelog\('\.', newVersion, fragments\)/);

    const python = readFileSync(
      join(repoRoot, 'python/scripts/version_and_commit.py'),
      'utf8'
    );
    assert.match(python, /collect_changelog\(new_version, project_root\)/);
  });

  it('orders collection after the bump inside those scripts', () => {
    const rust = readFileSync(
      join(repoRoot, 'rust/scripts/version-and-commit.mjs'),
      'utf8'
    );
    assert.ok(
      rust.indexOf('const newVersion = await findNextAvailableVersion') <
        rust.indexOf('collectFragments()')
    );

    const python = readFileSync(
      join(repoRoot, 'python/scripts/version_and_commit.py'),
      'utf8'
    );
    assert.ok(
      python.indexOf('new_version = bump_version(') <
        python.indexOf('collect_changelog(new_version')
    );
  });

  it('writes headings at the level the release scripts read', () => {
    // scriv defaults to level 1 while create_github_release.py extracts from
    // `## <version>`, so the two could never meet.
    const pyproject = readFileSync(
      join(repoRoot, 'python/pyproject.toml'),
      'utf8'
    );
    assert.match(pyproject, /^md_header_level = "2"$/m);

    const release = readFileSync(
      join(repoRoot, 'python/scripts/create_github_release.py'),
      'utf8'
    );
    assert.match(release, /rf"\^## \{re\.escape\(version\)\}/);
  });

  it('says so in the run summary when the notes are missing anyway', () => {
    // The fallback body is a silent downgrade: the release still goes out and
    // the job still passes.
    for (const path of [
      'js/scripts/create-github-release.mjs',
      'rust/scripts/create-github-release.mjs',
      'python/scripts/create_github_release.py',
    ]) {
      assert.match(
        readFileSync(join(repoRoot, path), 'utf8'),
        /::warning::/,
        `${path} drops the release notes without a word`
      );
    }
  });
});
