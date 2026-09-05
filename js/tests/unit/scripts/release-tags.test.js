/**
 * Guard for RC-D: the JS package and the Rust crate sharing one tag
 * namespace.
 *
 * Both released as `v<version>`, and their version numbers overlap -- 0.4.0,
 * 0.9.1 and 0.10.0 exist on both npm and crates.io. `git tag` refuses to
 * recreate an existing tag, so whichever language got there first owns the
 * name and the other silently releases without one. `v0.10.11` is a Rust
 * crate version, but in this repository it points at the commit that
 * released JS 0.17.0.
 *
 * Python already avoided this with a `python-v` prefix. The prefixes now
 * live in one place so that the three cannot drift back into each other.
 *
 * Analysis: dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-D
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { TAG_PREFIXES, releaseTag } from '../../../../scripts/release-tags.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('release tag namespaces', () => {
  it('gives every language its own prefix', () => {
    const prefixes = Object.values(TAG_PREFIXES);
    assert.equal(
      new Set(prefixes).size,
      prefixes.length,
      'two languages sharing a prefix means one of them cannot tag its release'
    );
  });

  it('cannot produce the same tag for two languages at the same version', () => {
    // The versions that actually collided.
    for (const version of ['0.4.0', '0.9.1', '0.10.0', '0.10.11', '0.17.0']) {
      const tags = Object.keys(TAG_PREFIXES).map((language) =>
        releaseTag(language, version)
      );
      assert.equal(
        new Set(tags).size,
        tags.length,
        `version ${version} produces a duplicate tag: ${tags.join(', ')}`
      );
    }
  });

  it('keeps `v*` matching the JS package only', () => {
    // Release tooling and humans both list JS releases with `git tag -l 'v*'`.
    for (const [language, prefix] of Object.entries(TAG_PREFIXES)) {
      if (language === 'js') {
        continue;
      }
      assert.ok(
        !prefix.startsWith('v'),
        `${language} uses ${prefix}, which a 'v*' glob would also match`
      );
    }
  });

  it('rejects an unknown language rather than guessing a prefix', () => {
    assert.throws(() => releaseTag('perl', '1.0.0'), /perl/);
  });

  it('matches the prefixes the workflows actually pass', () => {
    const expected = {
      'python.yml': TAG_PREFIXES.python,
      'rust.yml': TAG_PREFIXES.rust,
    };

    for (const [file, prefix] of Object.entries(expected)) {
      const workflow = readFileSync(
        join(repoRoot, '.github/workflows', file),
        'utf-8'
      );
      const passed = [...workflow.matchAll(/--tag-prefix "([^"]*)"/g)].map(
        (match) => match[1]
      );
      assert.ok(
        passed.length > 0,
        `${file} passes no --tag-prefix, so it falls back to the default`
      );
      for (const value of passed) {
        assert.equal(
          value,
          prefix,
          `${file} passes --tag-prefix "${value}" but scripts/release-tags.mjs says "${prefix}"`
        );
      }
    }
  });
});
