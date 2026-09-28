import assert from 'node:assert';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import { migrateHistory } from '../../../../src/browser/migration/history.js';
import {
  assertNothingMigrated,
  assertSourceUnchanged,
  migrateBetween,
  writeChromiumHistory,
} from '../../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-history-');

describe('migrateHistory', () => {
  it('snapshots History into the target and reports the URL count', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    writeChromiumHistory(source, 5);

    const report = await migrateBetween(migrateHistory, source, target);

    assert.equal(report.migrated, 1);
    await stat(path.join(target, 'History'));
    const warning = report.warnings.find((w) => w.reason === 'snapshot-copied');
    assert.ok(warning);
    assert.match(warning.detail, /5 history URLs/);
  });

  it('never writes to the source database', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    const historyPath = writeChromiumHistory(source, 2);

    await assertSourceUnchanged(historyPath, () =>
      migrateBetween(migrateHistory, source, target)
    );
  });

  it('reports a skip when there is no History database', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    const report = await migrateBetween(migrateHistory, source, target);
    assertNothingMigrated(report, 'source-missing');
  });
});
