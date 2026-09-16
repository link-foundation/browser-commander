/**
 * How long the old suggested-name trimming took on a page-chosen string.
 *
 * `sanitizeDownloadName` used `/^\s+|[\s.]+$/g` to strip the padding off a
 * filename the *page* supplies. The `[\s.]+$` half backtracks from every
 * position of a whitespace run that never reaches the end, so the cost is
 * quadratic in a string an attacker controls - CodeQL alert 19 on pull
 * request #91.
 *
 * Run with: `node experiments/download-name-redos.mjs`
 */

import { sanitizeDownloadName } from '../js/src/downloads/naming.js';

/** The regular expression the sanitizer used before the fix. */
const PADDING = /^\s+|[\s.]+$/g;

/**
 * Time one call.
 *
 * @param {Function} run - Work to measure
 * @returns {number} Milliseconds elapsed
 */
function timed(run) {
  const started = performance.now();
  run();
  return performance.now() - started;
}

for (const length of [10_000, 20_000, 40_000, 80_000]) {
  // A run of spaces with one non-matching character at the end: every start
  // position has to be tried, and every one of them fails at the same place.
  // Spaces rather than tabs, so that both sides see the same string - the
  // sanitizer strips control characters, and a tab is one.
  const hostile = `report${' '.repeat(length)}x`;

  const before = timed(() => hostile.replace(PADDING, ''));
  const after = timed(() => sanitizeDownloadName(hostile));

  console.log(
    `${String(length).padStart(6)} spaces: regex ${before.toFixed(1)}ms, ` +
      `sanitizer ${after.toFixed(1)}ms`
  );
}
