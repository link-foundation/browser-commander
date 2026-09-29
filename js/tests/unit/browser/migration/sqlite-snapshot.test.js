import assert from 'node:assert';
import { stat } from 'node:fs/promises';
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
