/**
 * Where managed downloads are written (issue #88).
 *
 * The directory is resolved, created and probed for writability *before* the
 * first download starts, because a permission problem discovered after a click
 * looks like a missing file and gets blamed on the page.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Presets accepted in place of an absolute path. */
export const DOWNLOAD_DIRECTORY_PRESETS = Object.freeze({
  USER_DOWNLOADS: 'user-downloads',
  TEMPORARY: 'temporary',
});

/** Owner-only file mode for saved artifacts. */
export const ARTIFACT_FILE_MODE = 0o600;

/** Owner-only directory mode for the download root. */
export const ARTIFACT_DIRECTORY_MODE = 0o700;

/**
 * Read the XDG user directory configuration.
 *
 * Linux users move their Downloads folder and localize its name; reading
 * `user-dirs.dirs` is what makes `user-downloads` mean their folder rather
 * than an English path that happens to exist.
 *
 * @returns {Promise<string|undefined>} Configured download directory
 */
async function xdgDownloadDirectory() {
  const configHome =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

  let contents;
  try {
    contents = await fs.readFile(
      path.join(configHome, 'user-dirs.dirs'),
      'utf8'
    );
  } catch {
    return undefined;
  }

  const match = contents.match(/^\s*XDG_DOWNLOAD_DIR\s*=\s*"(.*)"\s*$/m);
  if (!match) {
    return undefined;
  }

  return match[1].replace(/^\$HOME/, os.homedir());
}

/**
 * Resolve a download directory setting to an absolute path.
 *
 * @param {string} [directory] - Absolute path or a preset
 * @returns {Promise<string>} Absolute directory path
 */
export async function resolveDownloadDirectory(
  directory = DOWNLOAD_DIRECTORY_PRESETS.USER_DOWNLOADS
) {
  if (directory === DOWNLOAD_DIRECTORY_PRESETS.TEMPORARY) {
    return path.join(os.tmpdir(), 'browser-commander-downloads');
  }

  if (directory === DOWNLOAD_DIRECTORY_PRESETS.USER_DOWNLOADS) {
    return (
      (process.platform === 'linux'
        ? await xdgDownloadDirectory()
        : undefined) || path.join(os.homedir(), 'Downloads')
    );
  }

  if (typeof directory !== 'string' || !directory) {
    throw new TypeError(
      "downloads.directory must be an absolute path, 'user-downloads' or 'temporary'"
    );
  }

  if (!path.isAbsolute(directory)) {
    throw new Error(
      `downloads.directory must be absolute, received "${directory}"`
    );
  }

  return path.resolve(directory);
}

/**
 * Create the download directory and prove it can be written to.
 *
 * A directory that exists is not the same as a directory we may write in, so
 * the probe writes and removes a file rather than trusting the mode bits.
 *
 * @param {string} root - Absolute download directory
 * @returns {Promise<string>} The same directory, once it is usable
 * @throws {Error} When the directory cannot be created or written to
 */
export async function prepareDownloadDirectory(root) {
  try {
    await fs.mkdir(root, { recursive: true, mode: ARTIFACT_DIRECTORY_MODE });
  } catch (error) {
    throw new Error(
      `download directory ${root} could not be created: ${error.message}`,
      { cause: error }
    );
  }

  const probe = path.join(root, `.browser-commander-probe-${process.pid}`);
  try {
    await fs.writeFile(probe, '', { mode: ARTIFACT_FILE_MODE });
  } catch (error) {
    throw new Error(
      `download directory ${root} is not writable: ${error.message}`,
      { cause: error }
    );
  } finally {
    await fs.rm(probe, { force: true });
  }

  return root;
}
