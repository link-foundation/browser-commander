import { open, readFile } from 'node:fs/promises';
import * as bplist from 'bplist-parser';
import * as plist from 'plist';
import { parse } from 'csv-parse/sync';
import { matchesDomains } from './domains.js';
import { readDatabaseSnapshot } from './sqlite-snapshot.js';

import { withSafariAccess } from '../safari-access.js';
export { withSafariAccess } from '../safari-access.js';

export function readSafariPlist(filename) {
  return withSafariAccess(filename, async () => {
    const bytes = await readFile(filename);
    return bytes.subarray(0, 8).toString() === 'bplist00'
      ? bplist.parseBuffer(bytes)[0]
      : plist.parse(bytes.toString('utf8'));
  });
}

/** Canonical bookmark tree, including nested reading-list entries. */
export async function readSafariBookmarks(filename) {
  const document = await readSafariPlist(filename);
  function convert(node, readingList = false) {
    const isReadingList =
      readingList ||
      node.Title === 'com.apple.ReadingList' ||
      Boolean(node.ReadingList);
    if (node.WebBookmarkType === 'WebBookmarkTypeLeaf') {
      if (!node.URLString) {
        return null;
      }
      return {
        type: 'url',
        name: node.URIDictionary?.title ?? node.Title ?? node.URLString,
        url: node.URLString,
        readingList: isReadingList,
      };
    }
    return {
      type: 'folder',
      name: isReadingList ? 'Reading List' : (node.Title ?? ''),
      children: (node.Children ?? [])
        .map((child) => convert(child, isReadingList))
        .filter(Boolean),
    };
  }
  return (document.Children ?? []).map((node) => convert(node)).filter(Boolean);
}

/** All visits, in Unix microseconds; the source is read through online backup. */
export function readSafariHistory(filename, domains) {
  return withSafariAccess(filename, async () => {
    // Surface an OS access error before SQLite wraps it as SQLITE_CANTOPEN.
    const file = await open(filename, 'r');
    await file.close();
    return readDatabaseSnapshot({
      sourcePath: filename,
      read: (db) =>
        db
          .prepare(
            `SELECT i.url, v.title, v.visit_time FROM history_items i
       JOIN history_visits v ON i.id = v.history_item ORDER BY v.visit_time, v.id`
          )
          .all()
          .filter((row) => matchesDomains(row.url, domains))
          .map((row) => ({
            url: row.url,
            title: row.title ?? '',
            time: Math.round((row.visit_time + 978307200) * 1000000),
          })),
    });
  });
}

/** Only an explicitly supplied Safari/Passwords export is read. */
export async function readSafariPasswords(filename, domains) {
  const rows = parse(await readFile(filename), {
    columns: (columns) => {
      if (
        !['URL', 'Username', 'Password'].every((column) =>
          columns.includes(column)
        )
      ) {
        throw new TypeError(
          'Safari password CSV must have URL, Username and Password columns'
        );
      }
      return columns;
    },
    bom: true,
    skip_empty_lines: true,
  });
  return rows
    .filter((row) => row.URL && matchesDomains(row.URL, domains))
    .map((row) => {
      if (
        typeof row.Username !== 'string' ||
        typeof row.Password !== 'string'
      ) {
        throw new TypeError(
          'Safari password CSV must have URL, Username and Password columns'
        );
      }
      return {
        origin: row.URL,
        username: row.Username,
        password: row.Password,
      };
    });
}
