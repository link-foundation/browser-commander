#!/usr/bin/env node

/**
 * Minimal reproduction of the upstream defect behind RC-G.
 *
 * `@changesets/format`'s `detect()` chooses a formatter by looking for config
 * files, in this order: dprint, deno, oxfmt, biome, prettier. The `deno` entry
 * declares three config files:
 *
 *     configFiles: ['deno.json', 'deno.jsonc', { file: 'deno.json', key: 'fmt' }]
 *
 * The third entry is the precise question -- "does this project actually
 * configure `deno fmt`?" -- and it can never be reached, because the bare
 * string `'deno.json'` earlier in the same array matches first. So a
 * `deno.json` that says nothing at all about formatting still selects the deno
 * formatter, ahead of a prettier the project has actually installed.
 *
 * That matters more than a normal mis-detection because `deno` is the one
 * formatter in the table with no `packageName`: the others are invoked as
 * `npx <packageName>` and resolve out of node_modules, while deno is spawned
 * straight off PATH with no existence check and no fallback. On a runner
 * without Deno that is an unconditional `spawn deno ENOENT`, thrown from
 * inside `applyReleasePlan` after the version bump and the changelog have
 * been written but before the consumed changeset is deleted.
 *
 * Usage: node experiments/ci-repro/repro-changesets-format-detect.mjs
 * Exits 0 when the defect is present (fixture A detects deno), 1 when it is
 * not -- this is a probe of upstream behaviour, so "reproduced" is the
 * expected outcome until @changesets/format changes.
 *
 * Analysis: dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-G
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(join(process.cwd(), 'js', 'noop.js'));
const { detect, defaultDetectOrder } = await import(
  require.resolve('@changesets/format')
);

const root = mkdtempSync(join(tmpdir(), 'changesets-format-detect-'));

/**
 * Build a fixture directory and ask detect() which formatter it picks.
 * @param {string} name fixture directory name
 * @param {Record<string, string>} files file name -> contents
 * @returns {Promise<string|undefined>} the formatter detect() selected
 */
async function detectIn(name, files) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, contents] of Object.entries(files)) {
    writeFileSync(join(dir, file), contents);
  }
  return await detect({ cwd: dir, stopDir: dir });
}

try {
  console.log(
    '@changesets/format detection order:',
    defaultDetectOrder.join(', ')
  );
  console.log();

  const prettierOnly = await detectIn('prettier-only', { '.prettierrc': '{}' });
  const denoWithoutFmt = await detectIn('deno-without-fmt', {
    // Exactly what js/deno.json contained in this repository: it configures
    // the node_modules layout and the test globs, and says nothing about
    // formatting.
    'deno.json': JSON.stringify({ nodeModulesDir: 'auto' }),
    '.prettierrc': '{}',
  });
  const denoWithFmt = await detectIn('deno-with-fmt', {
    'deno.json': JSON.stringify({ fmt: { lineWidth: 80 } }),
    '.prettierrc': '{}',
  });

  const rows = [
    ['.prettierrc only', prettierOnly, 'prettier'],
    [
      'deno.json without an fmt key, plus .prettierrc',
      denoWithoutFmt,
      'prettier',
    ],
    ['deno.json with an fmt key, plus .prettierrc', denoWithFmt, 'deno'],
  ];
  for (const [label, actual, expected] of rows) {
    const verdict = actual === expected ? 'ok' : 'WRONG';
    console.log(
      `${verdict.padEnd(5)} ${label}: detected ${actual}, expected ${expected}`
    );
  }

  console.log();
  if (denoWithoutFmt === 'deno') {
    console.log(
      'Reproduced: the presence of deno.json alone selects the deno formatter,\n' +
        'so the { file: "deno.json", key: "fmt" } entry in the same configFiles\n' +
        'array is unreachable.'
    );
    process.exit(0);
  }
  console.log(
    'Not reproduced: detect() now honours the fmt key. Upstream has changed.'
  );
  process.exit(1);
} finally {
  rmSync(root, { recursive: true, force: true });
}
