#!/usr/bin/env node

/**
 * Duplication gate that prints the clones it fails on, and only those.
 *
 * With the console reporter, `jscpd --baseline … --fail-on-new-clones` lists
 * every clone it finds, accepted or not. A passing run printed 272 "Clone
 * found" blocks, about 840 lines, for clones the baseline already accepts. The
 * one clone that failed a run was marked only by a `[NEW]` tag somewhere in
 * that list (issue #128). This runs jscpd with the JSON reporter instead. It
 * prints the new clones from the report (as error annotations in GitHub
 * Actions) and a one-line total.
 *
 * `npx jscpd .` still prints every clone, and `.jscpd.json` keeps the console
 * reporter for that.
 *
 * Usage (from js/): node scripts/check-duplication.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE = '.jscpd-baseline.json';

/**
 * Path to jscpd's CLI entry point, or null when it is not installed. Running
 * it through `process.execPath` avoids the `.bin` shims, which Windows cannot
 * execute directly.
 */
export function resolveJscpdCli() {
  const require = createRequire(import.meta.url);
  let manifestPath;
  try {
    manifestPath = require.resolve('jscpd/package.json');
  } catch {
    return null;
  }
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = typeof bin === 'string' ? bin : bin?.jscpd;
  const cli = entry && path.join(path.dirname(manifestPath), entry);
  return cli && existsSync(cli) ? cli : null;
}

function escapeProperty(value) {
  return String(value)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
}

function escapeMessage(value) {
  return String(value)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
}

/**
 * The new clones in a jscpd JSON report, one line each.
 *
 * jscpd names code embedded in Markdown `README.md:javascript`, so the
 * language suffix is dropped before the name is used as a path. In GitHub
 * Actions each clone becomes an `::error` annotation on the
 * repository-relative path. `cwd` is where jscpd ran, and `workspace` is the
 * checkout root.
 *
 * @param {{duplicates: Array<object>}} report
 * @param {{githubActions?: boolean, cwd?: string, workspace?: string}} [options]
 */
export function formatNewClones(report, options = {}) {
  const {
    githubActions = false,
    cwd = process.cwd(),
    workspace = cwd,
  } = options;
  const fileOf = (side) => {
    const name = side.name.replace(/:[a-z]+$/, '');
    return githubActions
      ? path
          .relative(workspace, path.resolve(cwd, name))
          .split(path.sep)
          .join('/')
      : name;
  };

  return report.duplicates
    .filter((duplicate) => duplicate.isNew)
    .map(({ firstFile, secondFile, lines }) => {
      const first = fileOf(firstFile);
      const second = `${fileOf(secondFile)}:${secondFile.start}-${secondFile.end}`;
      if (!githubActions) {
        return `New clone: ${first}:${firstFile.start}-${firstFile.end} ~ ${second} (${lines} lines)\n`;
      }
      const properties = [
        `file=${escapeProperty(first)}`,
        `line=${firstFile.start}`,
        `endLine=${firstFile.end}`,
        'title=New duplicated code',
      ].join(',');
      const message =
        `${lines} lines duplicate ${second}. Extract the shared code, or ` +
        'accept the clone with `npm run check:duplication:update`.';
      return `::error ${properties}::${escapeMessage(message)}\n`;
    })
    .join('');
}

function main() {
  const cli = resolveJscpdCli();
  if (!cli) {
    console.error('jscpd is not installed; run npm ci in js/.');
    return 2;
  }

  const output = mkdtempSync(path.join(tmpdir(), 'jscpd-report-'));
  try {
    const jscpd = spawnSync(
      process.execPath,
      [
        cli,
        '.',
        '--baseline',
        BASELINE,
        '--fail-on-new-clones',
        '--reporters',
        'json',
        '--output',
        output,
        '--no-colors',
      ],
      { encoding: 'utf8' }
    );
    const reportPath = path.join(output, 'jscpd-report.json');
    if (jscpd.error || !existsSync(reportPath)) {
      // Fail closed: a run that produced no report proved nothing.
      process.stdout.write(jscpd.stdout ?? '');
      process.stderr.write(jscpd.stderr ?? '');
      console.error(
        `jscpd wrote no report (exit ${jscpd.status}): ${jscpd.error?.message ?? reportPath}`
      );
      return jscpd.status || 2;
    }

    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const newCount = report.duplicates.filter((d) => d.isNew).length;
    process.stdout.write(
      formatNewClones(report, {
        githubActions: process.env.GITHUB_ACTIONS === 'true',
        workspace: process.env.GITHUB_WORKSPACE || process.cwd(),
      })
    );
    const total = report.duplicates.length;
    console.log(
      `jscpd: ${total} clone${total === 1 ? '' : 's'}, ${newCount} new ` +
        `(the rest are accepted in ${BASELINE}).`
    );
    if (jscpd.status !== 0 && newCount === 0) {
      // jscpd failed for a reason other than new clones; show what it said.
      process.stdout.write(jscpd.stdout);
      process.stderr.write(jscpd.stderr);
    }
    return jscpd.status ?? 2;
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
