#!/usr/bin/env node

/**
 * Push the current commit to a shared branch, recovering from the one failure
 * a release job in this repository can actually hit: another language's
 * release wrote to `main` first.
 *
 * Why this exists
 * ---------------
 * All three release jobs share the `main-writer-${{ github.repository }}-main`
 * concurrency group, so they never run at the same time. They are still not
 * safe, because `actions/checkout@v6` checks out `github.sha` — the commit that
 * triggered the run — not the branch tip. Serialisation orders the writers; it
 * does not re-point their working trees. Every writer after the first therefore
 * holds a tree one commit behind `main` and its push is rejected as
 * non-fast-forward.
 *
 * That is exactly what happened in the runs listed in issue #85: the JS release
 * pushed `ab1c5aa 0.17.1` at 23:29:44, then the Python release (started
 * 23:30:09) and the Rust release (started 23:31:00) both pushed from a tree
 * still at `67c003c` and both failed. See
 * dev/log/issues/85/pulls/86/analysis/root-causes.md (RC-1) and the local
 * reproduction in experiments/ci-repro/repro-release-push-race.sh.
 *
 * Scope
 * -----
 * Only a lost race is retried. A repository-rule rejection (GH006/GH013) is
 * reported as itself and fails the job, because rebasing can never satisfy a
 * rule. The upstream template answers that case by landing the commit through
 * a pull request (scripts/land-via-pull-request.mjs); that fallback is
 * deliberately not adopted here — `main` in this repository accepts direct
 * pushes from `GITHUB_TOKEN`, as the successful JS release proves — so a rule
 * rejection means the repository configuration changed and a human should see
 * it rather than have a pull request opened silently.
 *
 * Tag ordering
 * ------------
 * A retry rebases HEAD onto the new remote head, which creates a *new* commit.
 * Any annotated tag created before the push would keep pointing at the
 * pre-rebase commit and be orphaned — reachable from no branch. Callers must
 * create and push release tags only after `pushWithRebaseRetry` resolves.
 * `js/tests/unit/scripts/push-with-rebase-retry.test.js` guards that ordering.
 *
 * Usage:
 *   import { pushWithRebaseRetry } from '../../scripts/push-with-rebase-retry.mjs';
 *   await pushWithRebaseRetry({ branch: 'main' });
 */

import { debug } from './debug-print.mjs';
import {
  isBlockedByRepositoryRule,
  isNonFastForward,
} from './push-failure-classifier.mjs';
import { commandErrorText, loadCommandStream } from './use-module.mjs';

/**
 * Total push attempts, so a single lost race costs one rebase. Three leaves
 * room for the rare case where a second writer lands between the rebase and
 * the retry.
 */
export const DEFAULT_ATTEMPTS = 3;

/**
 * Build the production git runner: a thin wrapper over `command-stream`'s `$`,
 * which is configured with `errexit`, so a non-zero exit rejects with an error
 * carrying `stdout` and `stderr` for the classifier to read.
 *
 * Loaded lazily so that importing this module — as the unit tests do, with an
 * injected runner — never reaches the network for `use-m`.
 *
 * @returns {Promise<(args: string[]) => Promise<unknown>>}
 */
export async function createGitRunner() {
  const { $ } = await loadCommandStream();
  return (args) => $`git ${args}`;
}

/**
 * Name of the branch HEAD is on.
 *
 * The Rust release script used a bare `git push`, which follows the current
 * branch's upstream. Replacing that with a hard-coded `HEAD:main` would change
 * behaviour for a `workflow_dispatch` run started from another branch, so the
 * branch is resolved instead of assumed.
 *
 * A detached HEAD has no branch name: `git rev-parse --abbrev-ref HEAD` prints
 * the literal string `HEAD`, and pushing `HEAD:HEAD` would aim at a remote
 * branch called `HEAD`. `actions/checkout` puts the runner on a real branch
 * for `push` and `workflow_dispatch` events, so this is unreachable from the
 * current workflows — but it is one `ref:` away from being reachable, and the
 * fallback is what the release means in that case anyway.
 *
 * @param {(args: string[]) => Promise<{stdout?: unknown}>} git git runner
 * @param {string} [fallback] branch to use when HEAD is detached or unnamed
 * @returns {Promise<string>} branch name
 */
export async function resolveCurrentBranch(git, fallback = 'main') {
  const result = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = String(result?.stdout ?? '').trim();
  return name && name !== 'HEAD' ? name : fallback;
}

/**
 * Push HEAD to `branch`, rebasing and retrying when the branch has advanced.
 *
 * @param {object} [options]
 * @param {(args: string[]) => Promise<unknown>} [options.git] git runner that
 *   rejects on a non-zero exit; injected by the tests
 * @param {string} [options.remote] remote name, default `origin`
 * @param {string} [options.branch] target branch, default `main`
 * @param {string} [options.refspec] override the pushed refspec, default
 *   `HEAD:<branch>`
 * @param {number} [options.attempts] total push attempts, default 3
 * @param {Console} [options.logger] console-like sink for progress lines
 * @param {(...parts: unknown[]) => unknown} [options.debugFn] debug sink,
 *   silent unless CI_SCRIPTS_DEBUG/RUNNER_DEBUG/ACTIONS_STEP_DEBUG is set
 * @returns {Promise<{pushed: true, via: 'direct'|'rebase', attempts: number}>}
 */
export async function pushWithRebaseRetry({
  git,
  remote = 'origin',
  branch = 'main',
  refspec,
  attempts = DEFAULT_ATTEMPTS,
  logger = console,
  debugFn = debug,
} = {}) {
  const run = git ?? (await createGitRunner());
  const target = refspec ?? `HEAD:${branch}`;
  const pushArgs = ['push', remote, target];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    debugFn(`push attempt ${attempt}/${attempts}: git ${pushArgs.join(' ')}`);
    try {
      await run(pushArgs);
      const via = attempt === 1 ? 'direct' : 'rebase';
      logger.log(
        attempt === 1
          ? `Pushed ${target} to ${remote}.`
          : `Pushed ${target} to ${remote} after ${attempt - 1} rebase(s).`
      );
      return { pushed: true, via, attempts: attempt };
    } catch (error) {
      debugFn(`push attempt ${attempt} failed:`, commandErrorText(error));

      if (isBlockedByRepositoryRule(error)) {
        // A rebase cannot satisfy a ruleset. Surface the real cause instead of
        // burning retries on a race that did not happen.
        logger.log(
          `::error::Push to ${remote}/${branch} was declined by a repository rule (GH006/GH013), not by a lost race. ` +
            'Rebasing cannot satisfy a branch protection rule; allow the release token to push to ' +
            `${branch}, or land this commit through a pull request.`
        );
        throw error;
      }

      if (!isNonFastForward(error)) {
        // Auth, network, or anything else a rebase cannot fix.
        logger.log(
          `::error::Push to ${remote}/${branch} failed for a reason a rebase cannot fix: ${commandErrorText(error)}`
        );
        throw error;
      }

      if (attempt === attempts) {
        logger.log(
          `::error::Push to ${remote}/${branch} still rejected as non-fast-forward after ${attempts} attempts.`
        );
        throw error;
      }

      logger.log(
        `::warning::Push to ${remote}/${branch} was rejected because the branch advanced; ` +
          `rebasing onto ${remote}/${branch} and retrying (attempt ${attempt + 1}/${attempts}).`
      );
      await run(['pull', '--rebase', remote, branch]);
    }
  }

  // Unreachable: the loop either returns or throws on its final attempt.
  throw new Error(
    `pushWithRebaseRetry exhausted ${attempts} attempts without a result`
  );
}
