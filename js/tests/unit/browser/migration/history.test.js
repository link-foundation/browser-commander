import assert from 'node:assert';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';

import { migrateHistory } from '../../../../src/browser/migration/history.js';

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-history-'));
  tempDirs.push(dir);
  return dir;
}

function writeHistory(dir, urlCount) {
  const db = new BetterSqlite3(path.join(dir, 'History'));
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT)');
  const insert = db.prepare('INSERT INTO urls (url, title) VALUES (?, ?)');
  for (let i = 0; i < urlCount; i += 1) {
    insert.run(`https://example.com/${i}`, `Page ${i}`);
  }
  db.close();
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('migrateHistory', () => {
  it('snapshots History into the target and reports the URL count', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    writeHistory(source, 5);

    const report = await migrateHistory({
      sourceProfileDir: source,
      targetProfileDir: target,
    });

    assert.equal(report.migrated, 1);
    await stat(path.join(target, 'History'));
    const warning = report.warnings.find((w) => w.reason === 'snapshot-copied');
    assert.ok(warning);
    assert.match(warning.detail, /5 history URLs/);
  });

  it('never writes to the source database', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    writeHistory(source, 2);
    const before = (await stat(path.join(source, 'History'))).mtimeMs;

    await migrateHistory({
      sourceProfileDir: source,
      targetProfileDir: target,
    });

    const after = (await stat(path.join(source, 'History'))).mtimeMs;
    assert.equal(before, after);
  });

  it('reports a skip when there is no History database', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    const report = await migrateHistory({
      sourceProfileDir: source,
      targetProfileDir: target,
    });
    assert.equal(report.migrated, 0);
    assert.equal(report.skipped[0].reason, 'source-missing');
  });
});
