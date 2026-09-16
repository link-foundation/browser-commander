/**
 * Checking owner-only permissions where the platform actually has them.
 *
 * Node accepts a `mode` on Windows and then ignores it: NTFS permissions are
 * ACLs, not POSIX bits, and `fs.stat` reports a synthesised `0o666` whatever
 * the file was created with. Asserting the mode there would be asserting
 * Node's emulation rather than our code, so the permission check runs on the
 * platforms that enforce it and the rest of each test runs everywhere.
 */

import assert from 'node:assert';
import fs from 'node:fs/promises';

/** Whether this platform enforces POSIX mode bits. */
export const HAS_POSIX_MODES = process.platform !== 'win32';

/**
 * Assert that a path carries the mode the code asked for.
 *
 * @param {string} target - File or directory to inspect
 * @param {number} expected - Expected permission bits, e.g. `0o600`
 * @returns {Promise<void>} Resolves once checked, or immediately on Windows
 */
export async function assertMode(target, expected) {
  if (!HAS_POSIX_MODES) {
    return;
  }

  const { mode } = await fs.stat(target);
  assert.strictEqual(mode & 0o777, expected);
}
