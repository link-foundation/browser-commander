import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';

/**
 * Small filesystem helpers shared by the migration data-class modules.
 */

/**
 * Return true when a path exists (of any type).
 *
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse a JSON file, returning null when it is missing or malformed.
 *
 * @param {string} filePath
 * @returns {Promise<Object|null>}
 */
export async function readJsonIfPresent(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Resolve a file inside a profile directory, or null when it is absent.
 *
 * @param {string} profileDir
 * @param {string} name - File name relative to the profile
 * @returns {Promise<string|null>}
 */
export async function profileFileIfPresent(profileDir, name) {
  const filePath = path.join(profileDir, name);
  return (await pathExists(filePath)) ? filePath : null;
}
