/**
 * Where the repository is, and how to run one of its shell scripts.
 *
 * Several checks this repository ships are bash scripts that a workflow calls
 * directly (`scripts/check-pipeline-status.sh`,
 * `scripts/run-with-budget-warning.sh`). Testing one means resolving the
 * repository root from the test file, spawning bash with a controlled
 * environment, and reading stdout and stderr together - CI interleaves them,
 * and a `::error::` annotation is only useful if the assertion sees it in the
 * same stream the runner does.
 *
 * Every test that needs those three things imports them from here, so the
 * duplication gate (`npm run check:duplication`) stays quiet and a change to
 * the spawning contract happens in one place.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../..'
);

/** Absolute path to a file, named the way the repository names it. */
export function repoPath(...segments) {
  return path.join(REPO_ROOT, ...segments);
}

/**
 * False on a runner without bash (a plain Windows image), where a test of a
 * bash script has nothing to say. Suites use it as `{ skip: !BASH_AVAILABLE }`
 * rather than asserting on an absent interpreter.
 */
export const BASH_AVAILABLE =
  spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8' }).status === 0;

/**
 * Run a bash script and return its exit status with stdout and stderr joined.
 *
 * `env` is merged over the caller's environment rather than replacing it: the
 * scripts under test call `node` and `git`, which need PATH.
 */
export function runBashScript(scriptPath, args = [], options = {}) {
  const result = spawnSync('bash', [scriptPath, ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });

  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}
