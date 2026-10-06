/**
 * Print text a contributor wrote without letting it act as a GitHub Actions
 * workflow command.
 *
 * The runner treats a log line starting with `::name::` (or `##[name]`) as a
 * command, so a changeset that quotes `::error::` would raise a fake
 * annotation, and `::add-mask::` or `::stop-commands::` would change what the
 * rest of the log shows. Wrapping the text in `::stop-commands::<token>` …
 * `::<token>::` turns command processing off for exactly that text.
 *
 * Adopted from the link-foundation pipeline templates (issue #128). GitHub
 * requires an unpredictable token per bracket: 16 random bytes in hex.
 */

import { randomBytes } from 'node:crypto';

/**
 * @param {unknown} value
 * @param {{stream?: {write: (text: string) => unknown}, githubActions?: boolean, tokenFactory?: () => string}} [options]
 */
export function printUntrusted(value, options = {}) {
  const stream = options.stream || process.stdout;
  const githubActions =
    options.githubActions ?? process.env.GITHUB_ACTIONS === 'true';
  const text = String(value);

  if (!githubActions) {
    stream.write(`${text}\n`);
    return;
  }

  const token = (
    options.tokenFactory || (() => randomBytes(16).toString('hex'))
  )();

  stream.write(`::stop-commands::${token}\n${text}\n::${token}::\n`);
}
