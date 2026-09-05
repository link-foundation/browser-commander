#!/usr/bin/env node

/**
 * Reproduction: `changeset version` aborts before it deletes the consumed
 * changeset files when a `deno.json` sits next to `package.json`.
 *
 * Root cause chain:
 *   1. `@changesets/apply-release-plan` formats the changelog it just wrote:
 *        `if (filesToFormat.length > 0) await (await getFormatter(config.format, cwd))(filesToFormat)`
 *   2. With the default `format: "auto"`, `detect()` from `@changesets/format`
 *      walks upwards looking for a formatter config. Its `defaultDetectOrder` is
 *        ["dprint", "deno", "oxfmt", "biome", "prettier"]
 *      so a `deno.json` wins over a prettier setup in the same directory.
 *   3. The deno formatter shells out to the `deno` binary. GitHub's
 *      `ubuntu-latest` image does not ship one, so `tinyexec` throws
 *      `spawn deno ENOENT` and `changeset version` exits 1.
 *   4. The deletion of the `.changeset/*.md` files runs *after* the formatting
 *      call, so it never happens. package.json and CHANGELOG.md are already
 *      written, which makes the failure look like a success to anything that
 *      only inspects the working tree.
 *
 * Consequence in this repository: the consumed changeset survives on `main`,
 * so the next push cuts another release carrying the same notes, for ever.
 *
 * Usage: node experiments/ci-repro/repro-changeset-deno-formatter.mjs
 * Requires Node >= 22 (the version @changesets/cli 3.x needs).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';

const CHANGESETS_VERSION = process.env.CHANGESETS_VERSION ?? '3.0.2';

function buildFixture({ withDenoJson }) {
  const dir = mkdtempSync(join(tmpdir(), 'changeset-deno-'));
  mkdirSync(join(dir, '.changeset'));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'repro-pkg', version: '1.0.0' }, null, 2) + '\n'
  );
  writeFileSync(
    join(dir, '.changeset/config.json'),
    JSON.stringify(
      {
        changelog: '@changesets/cli/changelog',
        commit: false,
        fixed: [],
        linked: [],
        access: 'public',
        baseBranch: 'main',
        updateInternalDependencies: 'patch',
        ignore: [],
      },
      null,
      2
    ) + '\n'
  );
  writeFileSync(
    join(dir, '.changeset/some-change.md'),
    "---\n'repro-pkg': minor\n---\n\nA change that should be consumed by `changeset version`.\n"
  );
  if (withDenoJson) {
    // Exactly what `js/deno.json` contains in this repository.
    writeFileSync(join(dir, 'deno.json'), JSON.stringify({ nodeModulesDir: 'auto' }, null, 2) + '\n');
  }
  execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', `@changesets/cli@${CHANGESETS_VERSION}`], {
    cwd: dir,
    stdio: 'ignore',
  });
  return dir;
}

/** Run `changeset version` with `deno` removed from PATH, like a GitHub runner. */
function runVersion(dir) {
  const scrubbedPath = (process.env.PATH ?? '')
    .split(delimiter)
    .filter((entry) => !existsSync(join(entry, 'deno')))
    .join(delimiter);
  const result = spawnSync(process.execPath, [join(dir, 'node_modules/.bin/changeset'), 'version'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: scrubbedPath },
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function inspect(dir) {
  return {
    version: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version,
    changelogWritten: existsSync(join(dir, 'CHANGELOG.md')),
    changesetSurvived: existsSync(join(dir, '.changeset/some-change.md')),
  };
}

function report(label, { withDenoJson }) {
  const dir = buildFixture({ withDenoJson });
  try {
    const { status, output } = runVersion(dir);
    const state = inspect(dir);
    console.log(`\n=== ${label} ===`);
    console.log(`  exit code ............. ${status}`);
    console.log(`  package.json version .. ${state.version}`);
    console.log(`  CHANGELOG.md written .. ${state.changelogWritten}`);
    console.log(`  changeset survived .... ${state.changesetSurvived}`);
    const denoError = /spawn deno ENOENT/.test(output);
    console.log(`  "spawn deno ENOENT" ... ${denoError}`);
    return { ...state, status, denoError };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const broken = report('WITH deno.json (current repository state)', { withDenoJson: true });
const healthy = report('WITHOUT deno.json (control)', { withDenoJson: false });

const failures = [];
if (broken.status === 0) failures.push('expected `changeset version` to fail when deno.json is present');
if (!broken.denoError) failures.push('expected a `spawn deno ENOENT` error');
if (broken.version !== '1.1.0') failures.push('expected the version bump to have been written already');
if (!broken.changesetSurvived) failures.push('expected the consumed changeset to survive the aborted run');
if (healthy.status !== 0) failures.push('expected the control run to succeed');
if (healthy.changesetSurvived) failures.push('expected the control run to delete the changeset');

console.log('');
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log('Reproduced: deno.json makes `changeset version` bump the version, write the');
console.log('changelog, then abort before deleting the changeset it just consumed.');
