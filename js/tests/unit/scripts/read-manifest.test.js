import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseArguments,
  readManifestField,
  readTomlField,
  replaceTomlField,
} from '../../../../scripts/read-manifest.mjs';

const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);

/**
 * The extraction the release jobs used before this script existed. Kept here so
 * the regression it caused stays visible next to the fix.
 * @param {string} content manifest source
 * @returns {string[]} every line-anchored `version = "..."` match
 */
function legacyGrepVersions(content) {
  return [...content.matchAll(/^version = "([^"]*)"/gm)].map(
    (match) => match[1]
  );
}

function readFixture(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), 'utf8');
}

describe('read-manifest', () => {
  it('reproduces the multi-match that broke the Python release', () => {
    // Both `[project].version` and `[tool.scriv].version` are line-anchored, so
    // the old grep wrote two lines into $GITHUB_OUTPUT and the step failed with
    // "Invalid format 'literal: pyproject.toml: project.version'".
    const matches = legacyGrepVersions(readFixture('python/pyproject.toml'));
    assert.ok(
      matches.length > 1,
      'expected pyproject.toml to still carry more than one line-anchored version key'
    );
    assert.ok(matches.includes('literal: pyproject.toml: project.version'));
  });

  it('reads the project version despite the scriv literal', () => {
    assert.equal(
      readManifestField(join(repositoryRoot, 'python/pyproject.toml')),
      readFixture('python/pyproject.toml').match(
        /^\[project\][\s\S]*?^version = "([^"]+)"/m
      )[1]
    );
  });

  it('reads the crate version and name past [[bin]] and [lib]', () => {
    const cargo = join(repositoryRoot, 'rust/Cargo.toml');
    assert.match(readManifestField(cargo), /^\d+\.\d+\.\d+/);
    assert.equal(
      readManifestField(cargo, { field: 'name' }),
      'browser-commander'
    );
  });

  it('reads the npm package version', () => {
    assert.match(
      readManifestField(join(repositoryRoot, 'js/package.json')),
      /^\d+\.\d+\.\d+/
    );
  });

  it('ignores a version declared in another table', () => {
    const toml = [
      '[tool.scriv]',
      'version = "literal: pyproject.toml: project.version"',
      '',
      '[project]',
      'version = "1.2.3"',
    ].join('\n');
    assert.equal(readTomlField(toml, 'project', 'version'), '1.2.3');
  });

  it('ignores a commented-out key and keeps a # inside a value', () => {
    const toml = [
      '[package]',
      '# version = "9.9.9"',
      'version = "1.0.0" # released',
      'description = "colors like #fff"',
    ].join('\n');
    assert.equal(readTomlField(toml, 'package', 'version'), '1.0.0');
    assert.equal(
      readTomlField(toml, 'package', 'description'),
      'colors like #fff'
    );
  });

  it('reads single-quoted TOML values', () => {
    assert.equal(
      readTomlField("[project]\nversion = '2.0.0'", 'project', 'version'),
      '2.0.0'
    );
  });

  it('fails loudly instead of emitting an empty version', () => {
    assert.throws(
      () =>
        readManifestField('pyproject.toml', {
          readFile: () => '[tool.scriv]\nversion = "literal: x"',
        }),
      /no non-empty "version" in \[project\]/
    );
  });

  it('fails loudly on an empty value rather than releasing it', () => {
    assert.throws(
      () =>
        readManifestField('Cargo.toml', {
          readFile: () => '[package]\nversion = ""',
        }),
      /no non-empty "version"/
    );
  });

  // The field name reaches this module through argv, so building a pattern
  // from it let `.` match any character and let `(` throw SyntaxError instead
  // of reporting a missing field. CodeQL flagged the same lines as
  // js/regex-injection on PR #82.
  it('compares the field name literally rather than as a pattern', () => {
    const toml = ['[package]', 'axb = "wrong"', 'name = "right"'].join('\n');

    assert.equal(readTomlField(toml, 'package', 'a.b'), undefined);
    assert.throws(
      () => replaceTomlField(toml, 'package', 'a.b', '9.9.9'),
      /No \[package\] a\.b to update/
    );
  });

  it('reports a missing field whose name is not a valid pattern', () => {
    const toml = ['[package]', 'name = "right"'].join('\n');

    assert.equal(readTomlField(toml, 'package', 'a('), undefined);
  });

  it('keeps spacing and a trailing comment when it rewrites a version', () => {
    const toml = ['[package]', '  version   =   "1.2.3"  # keep "this"'].join(
      '\n'
    );

    assert.equal(
      replaceTomlField(toml, 'package', 'version', '9.9.9'),
      ['[package]', '  version   =   "9.9.9"  # keep "this"'].join('\n')
    );
  });

  it('refuses to bump a version it cannot rewrite', () => {
    // Silently returning the file unchanged would publish the old version.
    assert.throws(
      () =>
        replaceTomlField(
          '[package]\nversion = 3',
          'package',
          'version',
          '9.9.9'
        ),
      /is not a quoted string/
    );
  });

  it('parses the CLI arguments the workflows pass', () => {
    assert.deepEqual(
      parseArguments([
        'rust/Cargo.toml',
        '--field',
        'name',
        '--output=crate_name',
      ]),
      {
        manifest: 'rust/Cargo.toml',
        field: 'name',
        table: undefined,
        output: 'crate_name',
      }
    );
  });

  it('rejects an invocation without exactly one manifest', () => {
    assert.throws(() => parseArguments([]), /Usage:/);
    assert.throws(() => parseArguments(['a.toml', 'b.toml']), /Usage:/);
  });
});
