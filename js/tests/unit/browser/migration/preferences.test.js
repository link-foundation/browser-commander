import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  MIGRATED_PREFERENCE_PATHS,
  mergePreferenceSubset,
  migratePreferences,
} from '../../../../src/browser/migration/preferences.js';
import {
  assertNothingMigrated,
  migrateBetween,
  readProfileJson,
  writeProfileJson,
} from '../../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-prefs-');

describe('mergePreferenceSubset', () => {
  it('copies only the documented subset and skips missing paths', () => {
    const source = {
      intl: { accept_languages: 'en-US,en' },
      download: { default_directory: '/home/alice/Downloads' },
      homepage: 'https://start.example/',
      unrelated: { setting: true },
    };
    const target = {};
    const { migratedPaths } = mergePreferenceSubset(source, target);

    assert.equal(target.intl.accept_languages, 'en-US,en');
    assert.equal(target.homepage, 'https://start.example/');
    assert.equal(target.unrelated, undefined);
    assert.ok(migratedPaths.includes('intl.accept_languages'));
    assert.ok(migratedPaths.includes('homepage'));
  });

  it('never migrates download.default_directory', () => {
    assert.ok(
      !MIGRATED_PREFERENCE_PATHS.includes('download.default_directory')
    );
    const source = { download: { default_directory: '/tmp/dl' } };
    const target = {};
    mergePreferenceSubset(source, target);
    assert.equal(target.download, undefined);
  });
});

describe('migratePreferences', () => {
  it('merges the subset into an existing target Preferences', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    await writeProfileJson(source, 'Preferences', {
      intl: { accept_languages: 'de-DE,de' },
      download: { default_directory: '/home/bob/Downloads' },
      session: { restore_on_startup: 4, startup_urls: ['https://x/'] },
    });
    await writeProfileJson(target, 'Preferences', {
      profile: { name: 'existing' },
    });

    const report = await migrateBetween(migratePreferences, source, target);

    assert.ok(report.migrated >= 2);
    const merged = await readProfileJson(target, 'Preferences');
    assert.equal(merged.intl.accept_languages, 'de-DE,de');
    assert.equal(merged.session.restore_on_startup, 4);
    assert.equal(merged.profile.name, 'existing');
    assert.equal(merged.download, undefined);
  });

  it('reports a skip when the source has no Preferences', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    const report = await migrateBetween(migratePreferences, source, target);
    assertNothingMigrated(report, 'source-missing');
  });
});
