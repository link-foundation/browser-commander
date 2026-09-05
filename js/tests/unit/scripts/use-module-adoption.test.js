/**
 * Guard that keeps every pipeline script on the use-m interop shim.
 *
 * A raw `const { $ } = await use('command-stream')` yields `undefined` on Node
 * 23+ because of the synthetic `module.exports` CommonJS export, so the script
 * dies with `TypeError: $ is not a function` inside a release job — which is
 * exactly how the JS Release and Rust Auto Release jobs failed on 2026-09-04.
 * Loading through scripts/use-module.mjs normalises that namespace, and this
 * test covers both language directories so the fix cannot be reintroduced in
 * only one of them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);

// Every directory holding release automation that loads packages through use-m.
const SCRIPT_DIRECTORIES = ['js/scripts', 'rust/scripts', 'scripts'];
const SHIM = 'use-module.mjs';

function scriptSources() {
  return SCRIPT_DIRECTORIES.flatMap((directory) =>
    readdirSync(join(repositoryRoot, directory))
      .filter((name) => name.endsWith('.mjs') && name !== SHIM)
      .map((name) => ({
        name: `${directory}/${name}`,
        source: readFileSync(join(repositoryRoot, directory, name), 'utf8'),
      }))
  );
}

describe('pipeline scripts load use-m through the interop shim', () => {
  it('finds the scripts it is meant to guard', () => {
    assert.ok(scriptSources().length > 10);
  });

  it('never destructures a package straight off use()', () => {
    const offenders = scriptSources()
      .filter(({ source }) =>
        /const\s*\{[^}]*\}\s*=\s*await\s+use\(/.test(source)
      )
      .map(({ name }) => name);
    assert.deepEqual(offenders, []);
  });

  it('never fetches and evals use.js inline', () => {
    const offenders = scriptSources()
      .filter(({ source }) =>
        /eval\(\s*\n?\s*await\s*\(await\s*fetch\(/.test(source)
      )
      .map(({ name }) => name);
    assert.deepEqual(offenders, []);
  });

  it('routes every shim consumer through scripts/use-module.mjs', () => {
    const offenders = scriptSources()
      .filter(({ source }) =>
        /load(CommandStream|LinoArguments)\(/.test(source)
      )
      .filter(({ source }) => !source.includes(SHIM))
      .map(({ name }) => name);
    assert.deepEqual(offenders, []);
  });
});
