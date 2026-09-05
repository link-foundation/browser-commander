#!/usr/bin/env node

/**
 * Check what `jscpd --fail-on-new-clones` tells you about the clones it fails
 * on.
 *
 * `js/package.json` runs the duplication gate as
 * `jscpd . --baseline .jscpd-baseline.json --fail-on-new-clones`, and its last
 * line is a bare count: "ERROR: jscpd found 2 new clones not in the baseline".
 * That line alone would make the gate unactionable, so this experiment builds a
 * two-file baseline, adds one new clone, and asserts that jscpd 5.x also marks
 * the offending clone `[NEW]` in the console report and names both of its
 * locations.
 *
 * It does, which is why this repository does not need a wrapper around the
 * gate: the count is a summary of a listing, not a replacement for one. The
 * check is kept because the listing comes from the `console` reporter
 * configured in `js/.jscpd.json` - a change to `reporters` there would leave
 * only the count, and this script would say so.
 *
 *   node experiments/ci-repro/check-jscpd-new-clone-reporting.mjs
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const JSCPD = path.join(
  REPO_ROOT,
  'js/node_modules/.bin',
  process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd'
);

const BASELINE_CLONE = `export function alpha(list) {
  const out = [];
  for (const item of list) {
    if (item === null || item === undefined) {
      continue;
    }
    out.push(String(item).trim().toLowerCase());
  }
  return out.filter((value) => value.length > 0).sort();
}
`;

const NEW_CLONE = `export function gamma(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (!row || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
  }
  return [...seen].sort((left, right) => left - right);
}
`;

// The console reporter colours its output; the markers are easier to assert on
// without the escape sequences.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

function runJscpd(directory, extraArgs) {
  const result = spawnSync(
    JSCPD,
    ['.', '--min-lines', '5', '--min-tokens', '30', ...extraArgs],
    { cwd: directory, encoding: 'utf8' }
  );

  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(ANSI, ''),
  };
}

const directory = mkdtempSync(path.join(tmpdir(), 'jscpd-new-clones-'));

try {
  mkdirSync(path.join(directory, 'src'));
  writeFileSync(path.join(directory, 'src/a.js'), BASELINE_CLONE);
  writeFileSync(path.join(directory, 'src/b.js'), BASELINE_CLONE);

  runJscpd(directory, [
    '--baseline',
    '.jscpd-baseline.json',
    '--update-baseline',
  ]);

  writeFileSync(path.join(directory, 'src/c.js'), NEW_CLONE);
  writeFileSync(path.join(directory, 'src/d.js'), NEW_CLONE);

  const { status, output } = runJscpd(directory, [
    '--baseline',
    '.jscpd-baseline.json',
    '--fail-on-new-clones',
  ]);

  const lines = output.split('\n');
  const marked = lines
    .map((line, index) =>
      line.includes('[NEW]') ? lines.slice(index, index + 3).join('\n') : ''
    )
    .filter(Boolean);

  console.log(`exit status: ${status} (expected 1)`);
  console.log(`clones marked [NEW]: ${marked.length} (expected 1)`);
  console.log(marked.join('\n'));

  const namesTheNewClone =
    marked.length === 1 &&
    marked[0].includes('src/c.js') &&
    marked[0].includes('src/d.js');

  console.log(
    namesTheNewClone
      ? 'PASS: the failing clone is named, not only counted'
      : 'FAIL: the gate reported a count without naming the new clone'
  );

  process.exitCode = status === 1 && namesTheNewClone ? 0 : 1;
} finally {
  rmSync(directory, { force: true, recursive: true });
}
