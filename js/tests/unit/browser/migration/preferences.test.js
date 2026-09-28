import assert from 'node:assert';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  MIGRATED_PREFERENCE_PATHS,
  mergePreferenceSubset,
  migratePreferences,
} from '../../../../src/browser/migration/preferences.js';

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-prefs-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

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
    await writeFile(
      path.join(source, 'Preferences'),
      JSON.stringify({
        intl: { accept_languages: 'de-DE,de' },
        download: { default_directory: '/home/bob/Downloads' },
        session: { restore_on_startup: 4, startup_urls: ['https://x/'] },
      })
    );
    await writeFile(
      path.join(target, 'Preferences'),
      JSON.stringify({ profile: { name: 'existing' } })
    );

    const report = await migratePreferences({
      sourceProfileDir: source,
      targetProfileDir: target,
    });

    assert.ok(report.migrated >= 2);
    const merged = JSON.parse(
      await readFile(path.join(target, 'Preferences'), 'utf8')
    );
    assert.equal(merged.intl.accept_languages, 'de-DE,de');
    assert.equal(merged.session.restore_on_startup, 4);
    assert.equal(merged.profile.name, 'existing');
    assert.equal(merged.download, undefined);
  });

  it('reports a skip when the source has no Preferences', async () => {
    const source = await makeTempDir();
    const target = await makeTempDir();
    const report = await migratePreferences({
      sourceProfileDir: source,
      targetProfileDir: target,
    });
    assert.equal(report.migrated, 0);
    assert.equal(report.skipped[0].reason, 'source-missing');
  });
});
