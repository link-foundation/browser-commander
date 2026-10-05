// Verify filtered Chromium History using the installed browser's real schema.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { migrateHistory } from '../../js/src/browser/migration/history.js';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { chromium } = require('playwright');
const Database = require('better-sqlite3');
const root = await mkdtemp(
  path.join(os.tmpdir(), 'bc-history-metadata-acceptance-')
);
const launchOptions = {
  headless: true,
  args: ['--no-sandbox'],
  executablePath: process.env.BROWSER_COMMANDER_CHROMIUM_EXECUTABLE,
};

async function restart(userDataDir) {
  const context = await chromium.launchPersistentContext(
    userDataDir,
    launchOptions
  );
  try {
    await context.pages()[0].goto('about:blank');
  } finally {
    await context.close();
  }
}

try {
  const sourceRoot = path.join(root, 'source');
  const targetRoot = path.join(root, 'target');
  await restart(sourceRoot);
  const source = path.join(sourceRoot, 'Default');
  const filename = path.join(source, 'History');
  const db = new Database(filename);
  const derived = ['clusters', 'cluster_keywords'];
  try {
    db.exec(`
      INSERT INTO urls(id,url,title,visit_count,typed_count,last_visit_time,hidden)
      VALUES(1001,'https://github.com/a','Selected',1,0,13344473600000001,0),
            (1002,'https://notgithub.com/b','Excluded',1,0,13344473600000002,0);
      INSERT INTO visits(id,url,visit_time,from_visit,transition,segment_id,visit_duration)
      VALUES(1001,1001,13344473600000001,0,0,0,0),
            (1002,1002,13344473600000002,0,0,0,0);
      CREATE TABLE "future history metadata"(value TEXT);
      INSERT INTO "future history metadata" VALUES('unrelated-history-marker');
    `);
    // Seed existing derived tables using their actual column defaults; no
    // assumed browser version or renamed foreign-family database is involved.
    for (const table of derived) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      assert.ok(
        columns.length,
        `${table} missing from installed History schema`
      );
      const overrides = {
        cluster_id: 1001,
        label: 'mixed unrelated-history-marker',
        raw_label: 'unrelated-history-marker',
        keyword: 'unrelated-history-marker',
      };
      const required = columns.filter(
        (column) =>
          Object.hasOwn(overrides, column.name) ||
          (column.notnull && column.dflt_value === null)
      );
      const values = required.map(
        (column) =>
          overrides[column.name] ??
          (/INT|BOOL|NUM|REAL|FLOAT|DOUBLE/i.test(column.type) ? 0 : '')
      );
      db.prepare(
        `INSERT INTO ${table} (${required.map(({ name }) => name).join(',')}) ` +
          `VALUES (${required.map(() => '?').join(',')})`
      ).run(...values);
    }
  } finally {
    db.close();
  }
  const before = await readFile(filename);
  const target = path.join(targetRoot, 'Default');
  const report = await migrateHistory({
    sourceProfileDir: source,
    targetProfileDir: target,
    domains: ['github.com'],
  });
  for (const table of [...derived, 'future history metadata']) {
    assert.ok(
      report.warnings.some(
        (entry) =>
          entry.item === table &&
          entry.reason === 'unsupported-history-metadata'
      ),
      table
    );
  }
  assert.ok(
    !(await readFile(path.join(target, 'History'))).includes(
      Buffer.from('unrelated-history-marker')
    )
  );
  await restart(targetRoot);
  const copy = new Database(path.join(target, 'History'), { readonly: true });
  try {
    assert.deepEqual(copy.prepare('SELECT url FROM urls ORDER BY id').all(), [
      { url: 'https://github.com/a' },
    ]);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM visits').get().n, 1);
    for (const table of derived) {
      assert.equal(
        copy.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,
        0
      );
    }
  } finally {
    copy.close();
  }
  assert.deepEqual(await readFile(filename), before);
  console.log(
    'Chromium retained the selected visit after restart; derived metadata was omitted with warnings and source bytes stayed unchanged.'
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
