import assert from 'node:assert';
import { stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';

import {
  readDatabaseSnapshot,
  withDatabaseSnapshot,
} from '../../../../src/browser/migration/sqlite-snapshot.js';
import {
  assertSourceUnchanged,
  writeChromiumHistory,
} from '../../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-snap-');

async function makeDatabase(rowCount) {
  return writeChromiumHistory(await makeTempDir(), rowCount);
}

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

  it('does not substitute an unverified file copy when backup fails', async () => {
    const sourcePath = path.join(await makeTempDir(), 'History');
    await writeFile(sourcePath, 'not a SQLite database');
    let readerCalled = false;
    await assert.rejects(
      withDatabaseSnapshot({
        sourcePath,
        read: () => {
          readerCalled = true;
        },
      }),
      /Consistent SQLite snapshot unavailable.*close the source browser/iu
    );
    assert.equal(readerCalled, false);
  });

  it(
    'reports guidance for an exclusive lock without invoking the reader',
    { timeout: 5000 },
    async () => {
      const sourcePath = await makeDatabase(1);
      const writer = new BetterSqlite3(sourcePath);
      writer.exec('BEGIN EXCLUSIVE');
      try {
        await assert.rejects(
          withDatabaseSnapshot({
            sourcePath,
            read: () => assert.fail('locked snapshot reader invoked'),
          }),
          /Consistent SQLite snapshot unavailable.*close the source browser/iu
        );
      } finally {
        writer.exec('ROLLBACK');
        writer.close();
      }
    }
  );

  it('includes committed WAL records while the source connection stays open', async () => {
    const sourcePath = await makeDatabase(1);
    const writer = new BetterSqlite3(sourcePath);
    writer.pragma('journal_mode = WAL');
    writer.prepare('UPDATE urls SET title = ?').run('committed WAL title');
    try {
      const title = await readDatabaseSnapshot({
        sourcePath,
        read: (db) => db.prepare('SELECT title FROM urls').get().title,
      });
      assert.equal(title, 'committed WAL title');
    } finally {
      writer.close();
    }
  });
});

describe('readDatabaseSnapshot', () => {
  it('opens the snapshot read-only and does not modify the source', async () => {
    const dbPath = await makeDatabase(2);
    let count;
    await assertSourceUnchanged(dbPath, async () => {
      count = await readDatabaseSnapshot({
        sourcePath: dbPath,
        read: (db) => db.prepare('SELECT COUNT(*) AS c FROM urls').get().c,
      });
    });
    assert.equal(Number(count), 2);
  });
});
