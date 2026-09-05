#!/usr/bin/env node
/**
 * Does `await $`cmd`` reject when `cmd` exits non-zero?
 *
 * rust/scripts/version-and-commit.mjs decides whether to commit the version
 * bump with:
 *
 *     try {
 *       await $`git diff --cached --quiet`.run({ capture: true });
 *       console.log('No changes to commit');   // <- taken on every run
 *       return;
 *     } catch {
 *       // there are changes
 *     }
 *
 * `git diff --cached --quiet` exits 1 when the index differs from HEAD, so the
 * catch branch is the "commit it" branch. If command-stream resolves instead of
 * rejecting on a non-zero exit, the bump is never committed, never tagged and
 * never pushed -- which is exactly what run 33974450069 printed.
 *
 * Run: node experiments/ci-repro/repro-command-stream-exit-code.mjs
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

import { loadCommandStream } from '../../scripts/use-module.mjs';

const { $ } = await loadCommandStream();

const repo = mkdtempSync(join(tmpdir(), 'cs-exit-'));
process.chdir(repo);
await $`git init -q -b main`;
await $`git config user.email t@example.com`;
await $`git config user.name t`;
writeFileSync('Cargo.toml', '[package]\nversion = "0.9.0"\n');
await $`git add Cargo.toml`;
await $`git commit -q -m initial`;

// Stage a real change, exactly as the release script does.
writeFileSync('Cargo.toml', '[package]\nversion = "0.10.0"\n');
await $`git add Cargo.toml`;

const rawExit = (await $`git diff --cached --quiet`.run({ capture: true }).catch(
  () => 'REJECTED'
));

console.log('node                :', process.version);
console.log('index has changes   : yes (Cargo.toml 0.9.0 -> 0.10.0)');
if (rawExit === 'REJECTED') {
  console.log('await $`git diff --cached --quiet` : REJECTED (catch branch runs -> commit happens)');
} else {
  console.log('await $`git diff --cached --quiet` : RESOLVED');
  console.log('  result.code       :', rawExit?.code);
  console.log('  => the try branch runs, script prints "No changes to commit" and returns');
}
// Control: what a plain shell reports for the very same command. `spawnSync` is
// used instead of another `$` call so that no template engine can expand `$?`
// before the inner shell sees it.
console.log('\nplain-shell control :');
const control = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: repo });
console.log('  git diff --cached --quiet exits with', control.status, '(non-zero = there ARE staged changes)');
