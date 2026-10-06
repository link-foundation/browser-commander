/**
 * Every real-browser suite is run by some workflow, or says why it is not.
 *
 * An end-to-end suite skips itself without `RUN_E2E` (or, in Rust, is marked
 * `#[ignore]`), and a skipped suite exits zero. So a suite that no workflow
 * opts into is not a failing check: it is no check at all, and CI stays green
 * while it rots. Issue #128 found ten of them across the three languages.
 *
 * This test lists the suites on disk and fails when one is neither invoked by
 * a workflow nor named in MANUAL_ONLY with a reason a reviewer can judge.
 * "Invoked" means the suite's file (JavaScript, Python) or test target (Rust,
 * together with `--ignored`) appears in a command a workflow runs, directly or
 * through the js/package.json script the command calls. Comments and `paths:`
 * filters do not count, and neither does a whole-directory run such as
 * `pytest tests/`, which collects the suites only to skip them.
 */

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { readRepoText, repoPath } from '../../helpers/repo.js';

/**
 * Suites no workflow can run, keyed by repository path. The reason is the
 * point: it is what a reviewer weighs when deciding whether the gap is real.
 */
const MANUAL_ONLY = {
  'js/tests/e2e/google-signin-probe.e2e.test.js':
    "Drives Google's live sign-in page, so a CI run would depend on a third-party site and risk tripping its abuse detection from a shared runner IP; it is opt-in through RUN_GOOGLE_PROBE.",
};

function listFiles(directory, pattern) {
  return readdirSync(repoPath(directory))
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => `${directory}/${name}`);
}

function baseName(file) {
  return file.slice(file.lastIndexOf('/') + 1);
}

const SUITES = [
  ...listFiles('js/tests/e2e', /\.e2e\.test\.js$/),
  ...listFiles('python/tests/e2e', /^test_.*\.py$/),
  ...listFiles('rust/tests', /\.rs$/).filter((file) =>
    /#\[ignore/.test(readRepoText(file))
  ),
];

/**
 * The commands a workflow runs: comment lines dropped, shell line
 * continuations joined so one command is one line, and the `on:` trigger
 * section (whose `paths:` filters list file names) left out.
 */
function workflowCommands(text) {
  const jobsStart = text.indexOf('\njobs:\n');

  return (jobsStart === -1 ? '' : text.slice(jobsStart))
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

const COMMANDS = readdirSync(repoPath('.github/workflows'))
  .filter((name) => name.endsWith('.yml'))
  .sort()
  .map((name) => ({
    workflow: name,
    commands: workflowCommands(readRepoText('.github/workflows', name)),
  }));

const PACKAGE_SCRIPTS = JSON.parse(readRepoText('js/package.json')).scripts;

function tokens(command) {
  return command.split(/[\s'"]+/).filter(Boolean);
}

/** The js/package.json scripts whose command names this file. */
function scriptsRunning(file) {
  const relative = file.replace(/^js\//, '');

  return Object.entries(PACKAGE_SCRIPTS)
    .filter(([, command]) => tokens(command).includes(relative))
    .map(([name]) => name);
}

/** Where the suite is run, as "<workflow>: <how>" strings. */
function findRunners(file) {
  const name = baseName(file);
  const runners = [];

  for (const { workflow, commands } of COMMANDS) {
    const lines = commands.split('\n');

    if (file.startsWith('rust/')) {
      const target = name.replace(/\.rs$/, '');
      const runsIt = lines.some((line) => {
        const words = tokens(line);
        return (
          words.includes('--ignored') &&
          words.some(
            (word, index) => word === '--test' && words[index + 1] === target
          )
        );
      });
      if (runsIt) {
        runners.push(`${workflow}: --test ${target} --ignored`);
      }
      continue;
    }

    if (
      lines.some((line) =>
        tokens(line).some((word) => word === name || word.endsWith(`/${name}`))
      )
    ) {
      runners.push(`${workflow}: ${name}`);
    }

    for (const script of scriptsRunning(file)) {
      const runsScript = lines.some((line) =>
        tokens(line).some(
          (word, index, words) =>
            word === script &&
            words[index - 1] === 'run' &&
            words[index - 2] === 'npm'
        )
      );
      if (runsScript) {
        runners.push(`${workflow}: npm run ${script}`);
      }
    }
  }

  return runners;
}

describe('end-to-end suite coverage', () => {
  it('finds the suites to check', () => {
    for (const language of ['js/', 'python/', 'rust/']) {
      assert.ok(
        SUITES.some((file) => file.startsWith(language)),
        `no ${language} end-to-end suites found; the file patterns are stale`
      );
    }
  });

  it('runs every end-to-end suite in some workflow, or says why not', () => {
    const unrun = SUITES.filter(
      (file) => !(file in MANUAL_ONLY) && findRunners(file).length === 0
    );

    assert.deepEqual(
      unrun,
      [],
      'these suites skip in every workflow, so CI is green whether or not they pass; run them in a workflow (.github/workflows/parity.yml) or add them to MANUAL_ONLY with a reason'
    );
  });

  it('keeps MANUAL_ONLY to suites that exist and that no workflow runs', () => {
    for (const [file, reason] of Object.entries(MANUAL_ONLY)) {
      assert.ok(SUITES.includes(file), `${file} is not an end-to-end suite`);
      assert.ok(reason.length > 40, `${file} needs a real reason`);
      assert.deepEqual(
        findRunners(file),
        [],
        `${file} is run by a workflow; drop it from MANUAL_ONLY`
      );
    }
  });
});
