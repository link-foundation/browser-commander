import assert from 'node:assert';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  migrateExtensions,
  selectMigratableExtensions,
} from '../../../../src/browser/migration/extensions.js';
import {
  migrateBetween,
  readProfileJson,
  writeProfileJson,
} from '../../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-ext-');

async function writeExtension(profileDir, id, version) {
  const dir = path.join(profileDir, 'Extensions', id, version);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name: id, version, manifest_version: 3 })
  );
}

describe('selectMigratableExtensions', () => {
  it('excludes policy-installed and component extensions', () => {
    const { eligible, excluded } = selectMigratableExtensions({
      user: { location: 1 },
      component: { location: 5 },
      policy: { location: 7 },
      external: { location: 10 },
    });
    assert.deepEqual(eligible, ['user']);
    assert.equal(excluded.length, 3);
    assert.ok(
      excluded.every((e) => e.reason === 'policy-or-component-extension')
    );
  });
});

describe('migrateExtensions', () => {
  it('copies eligible extension files and warns about the MAC', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    await writeExtension(source, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '1.0');
    await writeExtension(source, 'cccccccccccccccccccccccccccccccc', '2.0');
    await writeProfileJson(source, 'Secure Preferences', {
      extensions: {
        settings: {
          aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa: { location: 1, manifest: {} },
          cccccccccccccccccccccccccccccccc: { location: 5 },
        },
      },
    });

    const report = await migrateBetween(migrateExtensions, source, target);

    assert.equal(report.migrated, 1);
    assert.ok(
      report.skipped.some(
        (s) =>
          s.item === 'cccccccccccccccccccccccccccccccc' &&
          s.reason === 'policy-or-component-extension'
      )
    );
    assert.equal(report.warnings[0].reason, 'mac-will-not-validate');

    const copied = await readFile(
      path.join(
        target,
        'Extensions',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '1.0',
        'manifest.json'
      ),
      'utf8'
    );
    assert.match(copied, /manifest_version/);

    const targetSecure = await readProfileJson(target, 'Secure Preferences');
    assert.ok(
      targetSecure.extensions.settings.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    );
  });

  it('falls back to the directory listing without Secure Preferences', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    await writeExtension(source, 'dddddddddddddddddddddddddddddddd', '1.0');

    const report = await migrateBetween(migrateExtensions, source, target);
    assert.equal(report.migrated, 1);
  });

  it('reports nothing when there is no Extensions directory', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    const report = await migrateBetween(migrateExtensions, source, target);
    assert.deepEqual(report, { migrated: 0, skipped: [], warnings: [] });
  });
});
