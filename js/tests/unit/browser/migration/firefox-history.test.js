import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { it } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';

import { migrateProfile } from '../../../../src/browser/migration/index.js';
import { repoPath } from '../../../helpers/repo.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-ff-history-');
const schema = await readFile(
  repoPath('tests/fixtures/firefox-history.sql'),
  'utf8'
);

async function importHistory({ sql = schema, domains = [] } = {}) {
  const source = await makeTempDir();
  const target = path.join(await makeTempDir(), 'new-profile');
  const filename = path.join(source, 'places.sqlite');
  const db = new BetterSqlite3(filename);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
  const before = await readFile(filename);
  const report = await migrateProfile({
    from: { browser: 'firefox', userDataDir: source },
    to: target,
    include: ['history'],
    domains,
  });
  assert.deepEqual(await readFile(filename), before);
  return { report, target };
}

for (const domains of [[], ['GITHUB.COM.']]) {
  it(`translates Firefox visits with ${domains.length ? 'exact domain filtering' : 'all domains'}`, async () => {
    const { report, target } = await importHistory({ domains });
    const count = domains.length ? 3 : 4;
    assert.equal(report.migrated.history, count);
    assert.deepEqual(report.skipped, []);
    assert.equal(
      report.warnings[0].reason,
      'firefox-history-metadata-not-translated'
    );
    const db = new BetterSqlite3(path.join(target, 'History'), {
      readonly: true,
    });
    try {
      const rows = db
        .prepare(
          'SELECT url,title,visit_count,last_visit_time FROM urls ORDER BY url'
        )
        .safeIntegers()
        .all();
      assert.deepEqual(rows.slice(0, 2), [
        {
          url: 'https://docs.github.com/second',
          title: '',
          visit_count: 1n,
          last_visit_time: 13344473600000003n,
        },
        {
          url: 'https://github.com/first',
          title: 'First Ω',
          visit_count: 2n,
          last_visit_time: 13344473600000002n,
        },
      ]);
      const times = db
        .prepare('SELECT visit_time FROM visits ORDER BY visit_time')
        .safeIntegers()
        .all();
      assert.deepEqual(
        times.map(({ visit_time }) => visit_time),
        [
          13344473600000001n,
          13344473600000002n,
          13344473600000003n,
          13344473600000004n,
        ].slice(0, count)
      );
    } finally {
      db.close();
    }
    await assert.rejects(readFile(path.join(target, 'places.sqlite')), {
      code: 'ENOENT',
    });
  });
}

it('reports a missing Firefox visit table before creating the target', async () => {
  const { report, target } = await importHistory({
    sql: 'CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT)',
  });
  assert.equal(report.migrated.history, 0);
  assert.equal(report.skipped[0].reason, 'source-format-unsupported');
  assert.match(report.skipped[0].detail, /moz_historyvisits/u);
  await assert.rejects(readFile(path.join(target, 'History')), {
    code: 'ENOENT',
  });
});

for (const [field, values] of [
  [
    'timestamp',
    ['NULL', "'invalid'", '1.5', '-11644473600000001', '9223372036854775807'],
  ],
  ['url', ['NULL', "''", "x'0102'"]],
]) {
  it(`reports invalid visit ${field} without losing valid visits`, async () => {
    for (const value of values) {
      const extra =
        field === 'timestamp'
          ? `INSERT INTO moz_historyvisits VALUES (5,1,${value},1)`
          : `INSERT INTO moz_places VALUES (5,${value},'Invalid'); INSERT INTO moz_historyvisits VALUES (5,5,1700000000000005,1)`;
      const { report } = await importHistory({
        sql: `${schema}\n${extra}`,
        domains: ['github.com'],
      });
      assert.equal(report.migrated.history, 3);
      assert.equal(report.skipped.length, 1);
      assert.equal(report.skipped[0].reason, `invalid-history-${field}`);
      assert.equal(report.skipped[0].item, 'places.sqlite visit 5');
    }
  });
}
