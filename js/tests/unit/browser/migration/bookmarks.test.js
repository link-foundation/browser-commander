import assert from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  countBookmarks,
  migrateBookmarks,
} from '../../../../src/browser/migration/bookmarks.js';

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-bookmarks-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

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
    await writeFile(
      path.join(source, 'Bookmarks'),
      JSON.stringify(SAMPLE_BOOKMARKS)
    );

    const report = await migrateBookmarks({
      sourceProfileDir: source,
      targetProfileDir: target,
    });

    assert.equal(report.migrated, 2);
    assert.deepEqual(report.skipped, []);
    const copied = JSON.parse(
      await readFile(path.join(target, 'Bookmarks'), 'utf8')
    );
    assert.deepEqual(copied, SAMPLE_BOOKMARKS);
  });

  it('reports a skip when the source has no bookmarks', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    await mkdir(target, { recursive: true });

    const report = await migrateBookmarks({
      sourceProfileDir: source,
      targetProfileDir: target,
    });

    assert.equal(report.migrated, 0);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.skipped[0].reason, 'source-has-no-bookmarks');
  });
});
