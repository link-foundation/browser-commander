import { matchesDomains } from './domains.js';
import { profileFileIfPresent } from './fs-utils.js';
import { readDatabaseSnapshot } from './sqlite-snapshot.js';
import { writeChromiumHistory } from './chromium-writers.js';
import { preserveIntegerPrecision } from '../browser-cookie-database.js';

/** Translate individual Firefox visits using a consistent read-only snapshot. */
export async function migrateFirefoxHistory({
  profileDir,
  targetProfileDir,
  domains,
}) {
  const sourcePath = await profileFileIfPresent(profileDir, 'places.sqlite');
  const entry = (reason, detail, item = 'places.sqlite') => ({
    type: 'history',
    item,
    reason,
    detail,
  });
  if (!sourcePath) {
    return { migrated: 0, skipped: [entry('source-missing')], warnings: [] };
  }
  const rows = await readDatabaseSnapshot({
    sourcePath,
    read: (db) => {
      for (const [table, required] of [
        ['moz_places', ['id', 'url', 'title']],
        ['moz_historyvisits', ['id', 'place_id', 'visit_date']],
      ]) {
        const columns = new Set(
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map(({ name }) => name)
        );
        if (!required.every((name) => columns.has(name))) {
          return null;
        }
      }
      return preserveIntegerPrecision(
        db.prepare(
          'SELECT p.url,p.title,v.id,v.visit_date AS time FROM moz_historyvisits v JOIN moz_places p ON v.place_id=p.id ORDER BY v.visit_date,v.id'
        )
      ).all();
    },
  });
  if (rows === null) {
    return {
      migrated: 0,
      skipped: [
        entry(
          'source-format-unsupported',
          'Firefox history requires moz_places and moz_historyvisits with URL, title and integer visit dates; no target was written.'
        ),
      ],
      warnings: [],
    };
  }
  const skipped = [];
  const visits = [];
  for (const row of rows) {
    if (typeof row.url !== 'string' || !row.url) {
      skipped.push(
        entry(
          'invalid-history-url',
          'The visit URL is not a nonempty string.',
          `places.sqlite visit ${row.id}`
        )
      );
      continue;
    }
    if (!matchesDomains(row.url, domains)) {
      continue;
    }
    if (
      typeof row.time !== 'bigint' ||
      row.time < -11644473600000000n ||
      row.time > 9211727563254775807n
    ) {
      skipped.push(
        entry(
          'invalid-history-timestamp',
          'The visit date is not an integer representable in the target history format.',
          `places.sqlite visit ${row.id}`
        )
      );
      continue;
    }
    visits.push({ url: row.url, title: row.title ?? '', time: row.time });
  }
  const migrated = visits.length
    ? await writeChromiumHistory(targetProfileDir, visits)
    : 0;
  return {
    migrated,
    skipped,
    warnings: migrated
      ? [
          entry(
            'firefox-history-metadata-not-translated',
            'URL/title and visit dates were translated; Firefox transition types, referring visits and sync metadata were not copied.'
          ),
        ]
      : [],
  };
}
