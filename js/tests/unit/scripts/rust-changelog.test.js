/**
 * Guard for the half of RC-C that survives even after errexit is fixed.
 *
 * `rust/scripts/version-and-commit.mjs` carried its own copy of the changelog
 * collector, and that copy never deleted the fragments it consumed. The
 * standalone `rust/scripts/collect-changelog.mjs` did delete them, but only
 * the `manual-release` job ever calls it — `auto-release` used the inline
 * copy. So every automatic release re-published the same twelve entries.
 *
 * Both now share `rust/scripts/changelog.mjs`. These tests pin the behaviour
 * the inline copy was missing.
 *
 * See dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-C.
 */

import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  collectFragments,
  removeFragments,
  updateChangelog,
  INSERT_MARKER,
} from '../../../../rust/scripts/changelog.mjs';

/**
 * Build a throwaway crate directory with changelog fragments.
 * @param {{fragments?: Record<string,string>, changelog?: string|null}} [options]
 */
function fixture(options = {}) {
  const { fragments = {}, changelog = null } = options;
  const dir = mkdtempSync(join(tmpdir(), 'rust-changelog-'));
  const changelogDir = join(dir, 'changelog.d');
  mkdirSync(changelogDir);
  writeFileSync(join(changelogDir, 'README.md'), 'not a fragment\n');
  for (const [name, content] of Object.entries(fragments)) {
    writeFileSync(join(changelogDir, name), content);
  }
  if (changelog !== null) {
    writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  }
  return { dir, changelogDir };
}

const HEADER = `# Changelog

All notable changes to this project will be documented in this file.

${INSERT_MARKER}

## [0.1.0] - 2024-12-30

### Added

- Initial release
`;

describe('rust changelog collector', () => {
  it('deletes the fragments it consumed', () => {
    const { dir, changelogDir } = fixture({
      fragments: {
        '38.added.md': '### Added\n\n- A thing\n',
        '49.added.md': '### Added\n\n- Another thing\n',
      },
      changelog: HEADER,
    });

    updateChangelog(dir, '0.10.11', collectFragments(dir));
    removeFragments(dir);

    const left = readdirSync(changelogDir);
    assert.deepEqual(
      left,
      ['README.md'],
      'every consumed fragment must be gone; leaving them makes the next ' +
        'release re-publish the same notes'
    );
  });

  it('never deletes README.md', () => {
    const { dir, changelogDir } = fixture({
      fragments: { '1.added.md': '- x\n' },
      changelog: HEADER,
    });
    removeFragments(dir);
    assert.ok(existsSync(join(changelogDir, 'README.md')));
  });

  it('strips frontmatter carrying the bump type', () => {
    const { dir } = fixture({
      fragments: {
        '81.fixed.md': '---\nbump: patch\n---\n\n### Fixed\n\n- A fix\n',
      },
      changelog: HEADER,
    });
    const fragments = collectFragments(dir);
    assert.ok(!fragments.includes('bump: patch'));
    assert.ok(fragments.includes('- A fix'));
  });

  it('inserts the new entry directly after the marker, above older releases', () => {
    const { dir } = fixture({
      fragments: { '38.added.md': '### Added\n\n- New thing\n' },
      changelog: HEADER,
    });

    updateChangelog(dir, '0.10.11', collectFragments(dir));

    const content = readFileSync(join(dir, 'CHANGELOG.md'), 'utf-8');
    assert.ok(
      content.indexOf('## [0.10.11]') < content.indexOf('## [0.1.0]'),
      'newest release must come first'
    );
    assert.ok(
      content.indexOf(INSERT_MARKER) < content.indexOf('## [0.10.11]'),
      'the marker must stay above the entries so the next release can find it'
    );
  });

  it('reports no fragments rather than writing an empty release section', () => {
    const { dir } = fixture({ changelog: HEADER });
    assert.equal(collectFragments(dir), '');
  });

  it('creates CHANGELOG.md when it does not exist yet', () => {
    const { dir } = fixture({
      fragments: { '1.added.md': '### Added\n\n- First\n' },
    });

    updateChangelog(dir, '0.1.0', collectFragments(dir));

    const content = readFileSync(join(dir, 'CHANGELOG.md'), 'utf-8');
    assert.ok(content.includes(INSERT_MARKER));
    assert.ok(content.includes('## [0.1.0]'));
    assert.ok(content.includes('- First'));
  });
});
