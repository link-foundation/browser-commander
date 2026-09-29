import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './fs-utils.js';

/**
 * Bookmarks migration.
 *
 * Chrome stores bookmarks as a single JSON file, `Bookmarks`, in the profile
 * directory, with a `Bookmarks.bak` backup next to it. The file is
 * self-contained (there is no companion database), so a migration copies it as
 * is. Chrome recomputes the tamper-detection `checksum` in `Bookmarks` on the
 * next launch, so the copy is accepted even though its checksum was written for
 * the source profile.
 */

/**
 * Count the bookmark entries in a Bookmarks JSON tree, for the report.
 *
 * @param {Object} bookmarks
 * @returns {number}
 */
export function countBookmarks(bookmarks) {
  let count = 0;
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (node.type === 'url') {
      count += 1;
    }
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  for (const root of Object.values(bookmarks?.roots ?? {})) {
    visit(root);
  }
  return count;
}

/**
 * Copy the Bookmarks JSON from a source profile into the target profile.
 *
 * @param {Object} options
 * @param {string} options.sourceProfileDir
 * @param {string} options.targetProfileDir
 * @returns {Promise<{migrated: number, skipped: Array, warnings: Array}>}
 */
export async function migrateBookmarks({ sourceProfileDir, targetProfileDir }) {
  const source = path.join(sourceProfileDir, 'Bookmarks');
  if (!(await pathExists(source))) {
    return {
      migrated: 0,
      skipped: [
        {
          type: 'bookmarks',
          item: 'Bookmarks',
          reason: 'source-has-no-bookmarks',
        },
      ],
      warnings: [],
    };
  }
  let count = 0;
  try {
    count = countBookmarks(JSON.parse(await readFile(source, 'utf8')));
  } catch {
    // A count is best-effort; the copy is what matters.
  }
  await mkdir(targetProfileDir, { recursive: true });
  await copyFile(source, path.join(targetProfileDir, 'Bookmarks'));
  return { migrated: count, skipped: [], warnings: [] };
}
