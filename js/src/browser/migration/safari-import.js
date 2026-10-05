import path from 'node:path';
import { findSafariFile } from '../safari-access.js';
import {
  readSafariBookmarks,
  readSafariHistory,
  readSafariPasswords,
} from './safari.js';
import {
  writeChromiumBookmarks,
  writeChromiumHistory,
} from './chromium-writers.js';
import { writeChromiumPasswords } from './firefox.js';

function findStore(profileDir, name, legacyDir) {
  return findSafariFile([
    path.join(profileDir, 'Safari', name),
    path.join(profileDir, name),
    ...(legacyDir ? [path.join(legacyDir, name)] : []),
  ]);
}

export async function migrateSafariClass({
  type,
  profileDir,
  targetProfileDir,
  domains,
  passwordCsv,
  passwordKeys,
  platform,
  legacyDir,
}) {
  const skipped = (reason, detail) => ({
    migrated: 0,
    skipped: [
      { type, item: profileDir, reason, ...(detail ? { detail } : {}) },
    ],
    warnings: [],
  });
  if (type === 'preferences' || type === 'extensions') {
    return skipped(
      'safari-class-not-supported',
      'Safari preferences and extensions do not use Chromium formats.'
    );
  }
  if (type === 'passwords') {
    if (!passwordCsv) {
      return skipped(
        'safari-password-export-required',
        'Export Passwords from Safari or the Passwords app to CSV, then supply passwordCsv (CLI: --password-csv).'
      );
    }
    const entries = await readSafariPasswords(passwordCsv, domains);
    if (!passwordKeys?.targetKey) {
      return skipped(
        'target-key-unavailable',
        'Supply the dedicated target profile encryption key; no plaintext passwords are written.'
      );
    }
    const migrated = await writeChromiumPasswords({
      entries,
      targetProfileDir,
      platform,
      ...passwordKeys,
    });
    return { migrated, skipped: [], warnings: [] };
  }
  const filename = await findStore(
    profileDir,
    type === 'bookmarks' ? 'Bookmarks.plist' : 'History.db',
    legacyDir
  );
  if (!filename) {
    return skipped('source-missing');
  }
  if (type === 'bookmarks') {
    const entries = await readSafariBookmarks(filename);
    const hasReadingList = (nodes) =>
      nodes.some(
        (node) => node.readingList || hasReadingList(node.children ?? [])
      );
    const migrated = await writeChromiumBookmarks(targetProfileDir, entries);
    const warnings = hasReadingList(entries)
      ? [
          {
            type,
            item: filename,
            reason: 'safari-reading-list-translated',
            detail:
              'Reading-list URLs become bookmarks; read status and preview metadata are not translated.',
          },
        ]
      : [];
    return { migrated, skipped: [], warnings };
  }
  const migrated = await writeChromiumHistory(
    targetProfileDir,
    await readSafariHistory(filename, domains)
  );
  return { migrated, skipped: [], warnings: [] };
}
