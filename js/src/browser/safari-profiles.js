import path from 'node:path';
import { open } from 'node:fs/promises';
import { findSafariCookieFile } from './safari-cookies.js';
import { findSafariFile, withSafariAccess } from './safari-access.js';
import { openSqliteDatabase } from './browser-cookie-database.js';

/** SafariTabs supplies names; each UUID has separate Safari and WebKit stores. */
export async function listSafariProfiles(browser, root) {
  const profiles = [];
  const defaultFile =
    (await findSafariCookieFile(root)) ??
    (await findSafariFile([
      path.join(root, 'Safari/History.db'),
      path.join(root, 'History.db'),
      path.join(root, 'Safari/Bookmarks.plist'),
      path.join(root, 'Bookmarks.plist'),
    ]));
  if (defaultFile) {
    profiles.push({
      browser,
      name: 'Default',
      displayName: 'Default',
      path: root,
      isDefault: true,
    });
  }
  const tabs = await findSafariFile([
    path.join(root, 'Safari/SafariTabs.db'),
    path.join(root, 'SafariTabs.db'),
  ]);
  if (!tabs) {
    return profiles;
  }
  const rows = await withSafariAccess(tabs, async () => {
    const file = await open(tabs, 'r');
    await file.close();
    const db = await openSqliteDatabase(tabs, {
      readOnly: true,
      fileMustExist: true,
    });
    try {
      return db
        .prepare(
          "SELECT DISTINCT external_uuid,title FROM bookmarks WHERE subtype=2 AND external_uuid != 'DefaultProfile' ORDER BY external_uuid"
        )
        .all();
    } finally {
      db.close();
    }
  });
  for (const row of rows) {
    if (
      !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(
        row.external_uuid ?? ''
      )
    ) {
      continue;
    }
    const name = row.external_uuid.toUpperCase();
    const profilePath = path.join(root, 'Safari/Profiles', name);
    profiles.push({
      browser,
      name,
      displayName: row.title ?? name,
      path: profilePath,
      isDefault: false,
    });
  }
  return profiles;
}
