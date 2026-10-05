import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'node:test';
import path from 'node:path';
import Database from 'better-sqlite3';
import { useTempDirectories } from '../../../helpers/temp-directory.js';
import { migrateHistory } from '../../../../src/browser/migration/history.js';

const temporary = useTempDirectories('bc-history-metadata-');
for (const domains of [['github.com'], []]) {
  it(`${domains.length ? 'omits with warnings' : 'preserves'} derived history metadata`, async () => {
    const source = await temporary();
    const target = await temporary();
    const filename = path.join(source, 'History');
    const db = new Database(filename);
    db.exec(
      await readFile(
        new URL(
          '../../../../../tests/fixtures/history-opaque-metadata.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    db.close();
    const before = await readFile(filename);
    const report = await migrateHistory({
      sourceProfileDir: source,
      targetProfileDir: target,
      domains,
    });
    assert.equal(report.migrated, 1);
    const copy = new Database(path.join(target, 'History'));
    try {
      for (const [table, unfilteredCount] of [
        ['clusters', 2],
        ['clusters_and_visits', 3],
        ['cluster_keywords', 2],
        ['cluster_visit_duplicates', 2],
        ['future "history" metadata', 1],
      ]) {
        const quoted = `"${table.replaceAll('"', '""')}"`;
        const count = copy
          .prepare(`SELECT count(*) AS n FROM ${quoted}`)
          .get().n;
        assert.equal(count, domains.length ? 0 : unfilteredCount, table);
        assert.equal(
          report.warnings.some(
            (entry) =>
              entry.item === table &&
              entry.reason === 'unsupported-history-metadata'
          ),
          Boolean(domains.length)
        );
      }
      assert.equal(
        copy.prepare('SELECT count(*) AS n FROM urls').get().n,
        domains.length ? 1 : 2
      );
      assert.equal(
        copy.prepare('SELECT value FROM meta WHERE key=?').get('version').value,
        70
      );
    } finally {
      copy.close();
    }
    const bytes = await readFile(path.join(target, 'History'));
    assert.equal(
      bytes.includes(Buffer.from('unrelated-history-marker')),
      !domains.length
    );
    assert.deepEqual(await readFile(filename), before);
  });
}
