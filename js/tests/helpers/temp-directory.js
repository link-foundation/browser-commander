/**
 * Temporary directories for tests that write real files.
 *
 * Download and trace tests both need a directory of their own per test, and
 * both may leave it read-only on purpose, so the lifecycle lives in one place.
 */

import { afterEach, beforeEach } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Create a temporary directory.
 *
 * @param {string} [prefix] - Name prefix, to tell suites apart under /tmp
 * @returns {Promise<string>} Absolute directory path
 */
export async function makeTempDirectory(prefix = 'bc-test-') {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/**
 * Give each test in a suite its own directory.
 *
 * @param {string} [prefix] - Name prefix for the directories
 * @returns {{path: string}} Holder whose `path` is the current directory
 */
export function useTempDirectory(prefix) {
  const holder = { path: '' };

  beforeEach(async () => {
    holder.path = await makeTempDirectory(prefix);
  });

  afterEach(async () => {
    // A test may have made the directory read-only on purpose; removing it
    // still has to work, or the next test inherits the mess.
    await fs.chmod(holder.path, 0o700).catch(() => {});
    await fs.rm(holder.path, { recursive: true, force: true });
  });

  return holder;
}
