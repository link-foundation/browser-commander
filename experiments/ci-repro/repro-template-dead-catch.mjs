#!/usr/bin/env node

/**
 * RC-B in the upstream template: `try { await $`…` } catch { exit(1) }` never
 * catches.
 *
 * This repository inherited its release scripts from
 * link-foundation/js-ai-driven-development-pipeline-template, and it inherited
 * the defect with them. `command-stream` resolves its promise on a non-zero
 * exit instead of rejecting -- the opposite of `zx` and `execa` -- so every
 * error handler written in that shape is dead code. The template's own
 * `scripts/run-command.mjs` documents the hazard ("Unlike command-stream's
 * `$`, `runStrict` throws on a non-zero exit code, restoring `set -e`
 * semantics") but its release scripts do not use `runStrict`; they use `$`
 * from `scripts/use-module.mjs`, which does not set `errexit`.
 *
 * The template scripts written against the dead shape, as of 338fafa:
 *   scripts/changeset-version.mjs
 *   scripts/publish-to-npm.mjs
 *   scripts/version-and-commit.mjs
 *   scripts/format-github-release.mjs
 *   scripts/format-release-notes.mjs
 *
 * This probe contrasts the two loaders on one deliberately failing command:
 * the template's shape (no errexit) and this repository's fix (errexit on).
 *
 * Usage:
 *   node experiments/ci-repro/repro-template-dead-catch.mjs
 *
 * Exits 0 when the template shape is confirmed dead and the fixed shape
 * rejects; exits 1 if either half no longer behaves as described.
 *
 * Analysis: dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-B
 * Upstream report: dev/log/issues/83/pulls/84/templates/upstream-reports/
 */

import { loadCommandStream, useModule } from '../../scripts/use-module.mjs';

/**
 * Run a command that exits non-zero inside the idiom the release scripts use,
 * and report which branch actually ran.
 * @param {(strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>} $
 * @returns {Promise<{branch: 'try'|'catch', code: unknown}>}
 */
async function runFailingCommand($) {
  try {
    const result = await $`exit 7`;
    return { branch: 'try', code: result?.code };
  } catch (error) {
    return { branch: 'catch', code: error?.code };
  }
}

// The template's loader: command-stream straight from use-m, no shell settings.
// Order matters: `shell.errexit` is process-global state on the one cached
// module instance, so the unconfigured shape has to be measured first.
const templateShape = await useModule('command-stream', '$');
const template = await runFailingCommand(templateShape.$);

// This repository's loader after the fix in scripts/use-module.mjs.
const { $: strict } = await loadCommandStream();
const fixed = await runFailingCommand(strict);

console.log('node                :', process.version);
console.log(
  'template loader     : `exit 7` took the %s branch (code %s)',
  template.branch,
  template.code
);
console.log(
  'errexit loader      : `exit 7` took the %s branch (code %s)',
  fixed.branch,
  fixed.code
);
console.log();

const reproduced = template.branch === 'try';
const fixWorks = fixed.branch === 'catch';

if (reproduced && fixWorks) {
  console.log(
    'Reproduced: without `shell.errexit(true)` the catch branch is unreachable,\n' +
      'so a release script that "handles" a failure by exiting 1 instead\n' +
      'continues as though the command had succeeded. Enabling errexit in the\n' +
      'one place every script obtains `$` from restores the assumption they\n' +
      'are all written against.'
  );
  process.exit(0);
}

if (!reproduced) {
  console.log('Not reproduced: command-stream now rejects by default.');
}
if (!fixWorks) {
  console.log('Regression: loadCommandStream() no longer rejects on failure.');
}
process.exit(1);
