import assert from 'node:assert';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';

import {
  readDatabaseSnapshot,
  withDatabaseSnapshot,
} from '../../../../src/browser/migration/sqlite-snapshot.js';

const tempDirs = [];

async function makeDatabase(rowCount) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-snap-'));
  tempDirs.push(dir);
  const dbPath = path.join(dir, 'History');
  const db = new BetterSqlite3(dbPath);
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT)');
  const insert = db.prepare('INSERT INTO urls (url) VALUES (?)');
  for (let i = 0; i < rowCount; i += 1) {
    insert.run(`https://example.com/${i}`);
  }
  db.close();
  return dbPath;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('withDatabaseSnapshot', () => {
  it('produces a consistent snapshot readable by the reader', async () => {
    const dbPath = await makeDatabase(3);
    const count = await withDatabaseSnapshot({
      sourcePath: dbPath,
      read: (snapshotPath) => {
        const db = new BetterSqlite3(snapshotPath, { readonly: true });
        try {
          return db.prepare('SELECT COUNT(*) AS c FROM urls').get().c;
        } finally {
          db.close();
        }
      },
    });
    assert.equal(count, 3);
  });

  it('deletes the snapshot after the reader completes', async () => {
    const dbPath = await makeDatabase(1);
    let capturedPath;
    await withDatabaseSnapshot({
      sourcePath: dbPath,
      read: (snapshotPath) => {
        capturedPath = snapshotPath;
      },
    });
    await assert.rejects(stat(capturedPath));
  });

  it('rejects when the source does not exist', async () => {
    await assert.rejects(
      withDatabaseSnapshot({
        sourcePath: '/no/such/History',
        read: () => null,
      }),
      /does not exist/
    );
  });
});

describe('readDatabaseSnapshot', () => {
  it('opens the snapshot read-only and does not modify the source', async () => {
    const dbPath = await makeDatabase(2);
    const before = (await stat(dbPath)).mtimeMs;
    const count = await readDatabaseSnapshot({
      sourcePath: dbPath,
      read: (db) => db.prepare('SELECT COUNT(*) AS c FROM urls').get().c,
    });
    assert.equal(Number(count), 2);
    const after = (await stat(dbPath)).mtimeMs;
    assert.equal(before, after);
  });
});
