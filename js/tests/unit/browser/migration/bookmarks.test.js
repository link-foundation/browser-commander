import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  countBookmarks,
  migrateBookmarks,
} from '../../../../src/browser/migration/bookmarks.js';
import {
  assertNothingMigrated,
  migrateBetween,
  readProfileJson,
  writeProfileJson,
} from '../../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-bookmarks-');

const SAMPLE_BOOKMARKS = {
  checksum: 'source-checksum',
  roots: {
    bookmark_bar: {
      type: 'folder',
      children: [
        { type: 'url', name: 'A', url: 'https://a.example/' },
        {
          type: 'folder',
          children: [{ type: 'url', name: 'B', url: 'https://b.example/' }],
        },
      ],
    },
    other: { type: 'folder', children: [] },
  },
};

describe('countBookmarks', () => {
  it('counts url nodes recursively across roots', () => {
    assert.equal(countBookmarks(SAMPLE_BOOKMARKS), 2);
  });

  it('returns 0 for empty or invalid trees', () => {
    assert.equal(countBookmarks({}), 0);
    assert.equal(countBookmarks(null), 0);
  });
});

describe('migrateBookmarks', () => {
  it('copies the Bookmarks JSON verbatim and reports the count', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    await writeProfileJson(source, 'Bookmarks', SAMPLE_BOOKMARKS);

    const report = await migrateBetween(migrateBookmarks, source, target);

    assert.equal(report.migrated, 2);
    assert.deepEqual(report.skipped, []);
    const copied = await readProfileJson(target, 'Bookmarks');
    assert.deepEqual(copied, SAMPLE_BOOKMARKS);
  });

  it('reports a skip when the source has no bookmarks', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();

    const report = await migrateBetween(migrateBookmarks, source, target);

    assertNothingMigrated(report, 'source-has-no-bookmarks');
    assert.equal(report.skipped.length, 1);
  });
});
