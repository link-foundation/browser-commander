import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { openSqliteDatabase } from '../browser-cookie-database.js';

export async function writeChromiumBookmarks(targetProfileDir, entries) {
  let id = 3;
  let count = 0;
  function convert(node) {
    const result = {
      id: String(++id),
      date_added: '13300000000000000',
      name: node.name,
      type: node.type,
    };
    if (node.type === 'url') {
      count += 1;
      result.url = node.url;
    } else {
      result.date_modified = result.date_added;
      result.children = (node.children ?? []).map(convert);
    }
    return result;
  }
  const roots = Object.fromEntries(
    ['bookmark_bar', 'other', 'synced'].map((name, index) => [
      name,
      {
        id: String(index + 1),
        name,
        type: 'folder',
        date_added: '13300000000000000',
        date_modified: '13300000000000000',
        children: name === 'other' ? entries.map(convert) : [],
      },
    ])
  );
  await mkdir(targetProfileDir, { recursive: true });
  await writeFile(
    path.join(targetProfileDir, 'Bookmarks'),
    JSON.stringify({ version: 1, roots })
  );
  return count;
}

export async function writeChromiumHistory(targetProfileDir, entries) {
  await mkdir(targetProfileDir, { recursive: true });
  const db = await openSqliteDatabase(path.join(targetProfileDir, 'History'));
  try {
    db.exec(
      await readFile(new URL('./chromium-history.sql', import.meta.url), 'utf8')
    );
    const urls = new Map();
    const insertUrl = db.prepare(
      'INSERT INTO urls (url,title,visit_count,last_visit_time) VALUES (?,?,0,0)'
    );
    const updateUrl = db.prepare(
      'UPDATE urls SET title=?, visit_count=visit_count+1,last_visit_time=max(last_visit_time,?) WHERE id=?'
    );
    const insertVisit = db.prepare(
      'INSERT INTO visits (url,visit_time) VALUES (?,?)'
    );
    db.exec('BEGIN');
    try {
      for (const entry of entries) {
        if (!urls.has(entry.url)) {
          urls.set(
            entry.url,
            insertUrl.run(entry.url, entry.title).lastInsertRowid
          );
        }
        const id = urls.get(entry.url);
        const time = BigInt(entry.time) + 11644473600000000n;
        updateUrl.run(entry.title, time, id);
        insertVisit.run(id, time);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
  return entries.length;
}
