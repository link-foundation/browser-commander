/**
 * Classify a rejected `git push` so a release job picks the only recovery that
 * can actually work.
 *
 * Two rejections print the same word — "rejected" — and need opposite
 * responses:
 *
 *   lost race (rebasing onto the new remote head fixes it)
 *     ! [rejected]        main -> main (non-fast-forward)
 *     ! [rejected]        HEAD -> main (fetch first)
 *
 *   repository rule violation (rebasing can NEVER fix it)
 *     remote: error: GH013: Repository rule violations found for refs/heads/main.
 *     remote: - Changes must be made through a pull request.
 *      ! [remote rejected] main -> main (push declined due to repository rule violations)
 *
 * Retrying the second as if it were the first burns the retry, doubles the
 * time the release job takes to die, and leaves a log that blames a race that
 * never happened.
 *
 * The first form is what failed the Python and Rust "Auto Release" jobs in the
 * runs listed in issue #85; see
 * dev/log/issues/85/pulls/86/analysis/root-causes.md, RC-1.
 *
 * Ported from link-foundation/js-ai-driven-development-pipeline-template's
 * scripts/push-failure-classifier.mjs so that all three languages in this
 * repository classify a rejection the same way.
 */

/**
 * Server-side refusals to accept a direct push: legacy branch protection
 * (GH006) and repository rulesets (GH013). No client-side history rewrite can
 * satisfy them, so the change has to arrive through a pull request instead.
 * @type {readonly string[]}
 */
export const REPOSITORY_RULE_PATTERNS = Object.freeze([
  'gh006', // legacy protected-branch rejection
  'gh013', // repository rule violations
  'repository rule violations',
  'changes must be made through a pull request',
  'protected branch',
  'push declined',
]);

/**
 * Rejections caused by the remote branch having advanced. Only these are fixed
 * by rebasing onto the new remote head and pushing again.
 *
 * `fetch first` is listed alongside `non-fast-forward` because git chooses
 * between the two wordings by whether the local ref knows about the remote's
 * new commits, which depends on when the ref was last fetched. The CI logs in
 * dev/log/issues/85/pulls/86/ci-logs/ show `non-fast-forward`; the local
 * reproduction in experiments/ci-repro/repro-release-push-race.sh shows
 * `fetch first` for the same situation.
 * @type {readonly string[]}
 */
export const NON_FAST_FORWARD_PATTERNS = Object.freeze([
  '[rejected]',
  'non-fast-forward',
  'fetch first',
  'updates were rejected',
]);

/**
 * Flatten a command failure — a `command-stream` rejection, a plain Error or a
 * bare string — into one lowercase haystack.
 *
 * `stdout` and `stderr` are included because git writes the rejection to
 * stderr while the rejection *reason* ("hint: Updates were rejected...") can
 * land in either stream depending on the transport.
 *
 * @param {{stdout?: unknown, stderr?: unknown, message?: unknown}|string|null|undefined} failure
 * @param {boolean} [includeMessage] include `message` in the haystack
 * @returns {string}
 */
function combinedOutput(failure, includeMessage = true) {
  if (failure === null || failure === undefined) {
    return '';
  }
  if (typeof failure === 'string') {
    return failure.toLowerCase();
  }
  const parts = [failure.stdout, failure.stderr];
  if (includeMessage) {
    parts.push(failure.message);
  }
  return parts
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .join('\n')
    .toLowerCase();
}

/**
 * Whether the remote rejected the push because of branch protection or a
 * repository ruleset.
 * @param {{stdout?: unknown, stderr?: unknown, message?: unknown}|string|null|undefined} failure
 * @returns {boolean}
 */
export function isBlockedByRepositoryRule(failure) {
  const output = combinedOutput(failure);
  return REPOSITORY_RULE_PATTERNS.some((pattern) => output.includes(pattern));
}

/**
 * Whether the remote rejected the push because the branch has advanced.
 *
 * A ruleset rejection also prints "rejected", so it is excluded first.
 *
 * `message` is deliberately left out of the haystack here: `command-stream`
 * rejects with the generic "Command failed with exit code 1", and a caller
 * that had already wrapped the failure could put the word "rejected" into a
 * message of its own making. The classification must rest on what git wrote.
 *
 * @param {{stdout?: unknown, stderr?: unknown, message?: unknown}|string|null|undefined} failure
 * @returns {boolean}
 */
export function isNonFastForward(failure) {
  if (isBlockedByRepositoryRule(failure)) {
    return false;
  }
  const output = combinedOutput(failure, false);
  return NON_FAST_FORWARD_PATTERNS.some((pattern) => output.includes(pattern));
}

/**
 * One of the three things a rejected push can mean.
 *
 * @param {{stdout?: unknown, stderr?: unknown, message?: unknown}|string|null|undefined} failure
 * @returns {'repository-rule'|'non-fast-forward'|'unknown'}
 */
export function classifyPushFailure(failure) {
  if (isBlockedByRepositoryRule(failure)) {
    return 'repository-rule';
  }
  if (isNonFastForward(failure)) {
    return 'non-fast-forward';
  }
  return 'unknown';
}
