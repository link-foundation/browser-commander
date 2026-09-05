/**
 * Guard for RC-G: `changeset version` aborting on a formatter that is not
 * installed.
 *
 * @changesets/cli v3 formats the changelog it writes. With the default
 * `"format": "auto"`, @changesets/format walks `defaultDetectOrder` --
 * dprint, deno, oxfmt, biome, prettier -- and picks the first formatter whose
 * config file it finds. `js/deno.json` existed -- orphaned configuration no
 * workflow ever used -- so deno won over the prettier this package actually
 * depends on. deno is the one entry in that table with
 * no `packageName`, so it is spawned straight off PATH with no existence
 * check and no npx fallback; GitHub's ubuntu-latest runner has no deno.
 *
 * `changeset version` therefore bumped package.json, wrote CHANGELOG.md, and
 * then died with `spawn deno ENOENT` before deleting the changeset it had
 * just consumed. The release still shipped -- 0.17.0 is on npm -- but
 * `merged-loud-river.md` survived to be released a second time, and the
 * half-written CHANGELOG.md kept trailing whitespace that fails
 * `prettier --check`.
 *
 * Reproduction: experiments/ci-repro/repro-changeset-deno-formatter.mjs
 * Analysis: dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-G
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);

const config = JSON.parse(
  readFileSync(join(packageRoot, '.changeset/config.json'), 'utf-8')
);

describe('changesets formatter', () => {
  it('pins a formatter instead of auto-detecting one', () => {
    assert.notEqual(
      config.format,
      undefined,
      'omitting `format` means "auto", which detects whichever formatter ' +
        'config happens to sit beside package.json and then fails on a ' +
        'runner that has no such binary'
    );
    assert.notEqual(config.format, 'auto', 'same as omitting it');
  });

  it('pins a formatter this package can actually run', () => {
    // `false` disables formatting, which is also a safe answer.
    if (config.format === false) {
      return;
    }

    const { defaultDetectOrder } = require('@changesets/format');
    assert.ok(
      defaultDetectOrder.includes(config.format),
      `unknown formatter ${JSON.stringify(config.format)}; expected one of ${defaultDetectOrder.join(
        ', '
      )}`
    );

    // @changesets/format keeps the formatter table private, so mirror the
    // one fact this test needs: which formatters it resolves through
    // node_modules and which it spawns straight off PATH. `deno` is the
    // single entry with no package, which is why it cannot be relied on.
    const packageNames = {
      dprint: 'dprint',
      deno: null,
      oxfmt: 'oxfmt',
      biome: '@biomejs/biome',
      prettier: 'prettier',
    };
    const packageName = packageNames[config.format];
    assert.ok(
      packageName,
      `${config.format} is spawned straight off PATH with no npx fallback, ` +
        'so it cannot be relied on inside a release job'
    );
    assert.ok(
      existsSync(join(packageRoot, 'node_modules', packageName)),
      `${packageName} is not installed in this package`
    );
  });

  it('leaves no consumed changeset behind', () => {
    const changesetDir = join(packageRoot, '.changeset');
    const pending = readdirSync(changesetDir).filter(
      (file) => file.endsWith('.md') && file !== 'README.md'
    );

    const changelog = readFileSync(join(packageRoot, 'CHANGELOG.md'), 'utf-8');
    for (const file of pending) {
      const body = readFileSync(join(changesetDir, file), 'utf-8')
        .replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '')
        .trim();
      const firstLine = body.split('\n')[0].trim();
      assert.ok(
        firstLine.length === 0 || !changelog.includes(firstLine),
        `.changeset/${file} describes a change that CHANGELOG.md already ` +
          'records as released; `changeset version` consumed it but did not ' +
          'delete it, so the next release will publish it again'
      );
    }
  });
});
