/**
 * Guard the release commit against the formatting gate that never sees it.
 *
 * `version-and-commit.mjs` pushes the bump with `GITHUB_TOKEN`, and a push
 * authenticated with `GITHUB_TOKEN` does not start a workflow run. Nothing
 * therefore inspects the files the bump generated -- CHANGELOG.md,
 * package.json, package-lock.json. When `changeset version` wrote a
 * CHANGELOG.md that Prettier rejects, main's `format:check` went red and
 * stayed red, because the only runs that could have reported it were the ones
 * the push never triggered.
 *
 * This module has no side effects on import: the shell is passed in, so the
 * behaviour is testable without running a release.
 */

export const FORMAT_CHECK_COMMAND = 'npm run format:check';

export const FORMAT_FAILURE_TITLE = 'Release commit is not formatted';

/**
 * Build the annotation shown when the generated files fail the gate.
 *
 * A workflow command ends at the first newline, so the message is a single
 * line and the captured output is printed separately.
 * @returns {string}
 */
export function formatFailureAnnotation() {
  return (
    `::error title=${FORMAT_FAILURE_TITLE}::The version bump wrote files that ` +
    'Prettier rejects. Pushing them would leave main failing format:check, ' +
    'and the push does not trigger a run that would report it. Fix the ' +
    'generator (see .changeset/config.json "format") rather than reformatting ' +
    'by hand.'
  );
}

/**
 * Extract the reason a command-stream failure carries.
 *
 * With `errexit` on, `error.message` is only "Command failed with exit code
 * N"; the diagnosis is in the captured streams.
 * @param {unknown} error
 * @returns {string}
 */
export function formatFailureDetails(error) {
  const streams = error && typeof error === 'object' ? error : {};
  return [streams.stdout, streams.stderr]
    .map((stream) => String(stream ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Run the repository's formatting gate over the generated release commit.
 *
 * Rethrows on failure so the release stops before the push.
 * @param {() => Promise<unknown>} runCheck
 * @param {{log?: (message: string) => void, error?: (message: string) => void}} [console_]
 * @returns {Promise<void>}
 */
export async function assertGeneratedFilesAreFormatted(
  runCheck,
  console_ = console
) {
  const log = console_.log ?? (() => {});
  const error = console_.error ?? (() => {});

  log('Checking that the release commit is formatted...');
  try {
    await runCheck();
  } catch (failure) {
    error(formatFailureAnnotation());
    const details = formatFailureDetails(failure);
    if (details) {
      error(details);
    }
    throw failure;
  }
  log('Release commit is formatted');
}
