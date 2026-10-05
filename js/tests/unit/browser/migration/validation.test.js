import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { migrateProfile } from '../../../../src/browser/migration/index.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const temporary = useTempDirectories('bc-validation-');

describe('migration validation before target mutation', () => {
  it('rejects unknown classes and invalid domain filters', async () => {
    for (const options of [
      { include: ['invented'] },
      { domains: ['https://example.com'] },
    ]) {
      const target = await temporary();
      await assert.rejects(
        migrateProfile({ from: { browser: 'chrome' }, to: target, ...options })
      );
      assert.deepEqual(await readdir(target), []);
    }
  });

  it('rejects unsupported target layouts before creating Chromium files', async () => {
    const target = await temporary();
    await assert.rejects(
      migrateProfile({
        from: { browser: 'chrome' },
        to: target,
        include: ['bookmarks'],
        targetBrowser: 'firefox',
      }),
      /target/u
    );
    assert.deepEqual(await readdir(target), []);
  });

  it('rejects detection-only sources before target mutation', async () => {
    const source = await temporary();
    const target = await temporary();
    await assert.rejects(
      migrateProfile({
        from: { browser: 'duckduckgo', userDataDir: source },
        to: target,
        include: ['history'],
      }),
      /detection/u
    );
    assert.deepEqual(await readdir(target), []);
  });

  it('rejects a target that overlaps the source profile', async () => {
    const source = await temporary();
    await assert.rejects(
      migrateProfile({
        from: { browser: 'opera', userDataDir: source },
        to: source,
        include: ['bookmarks'],
      }),
      /overlap/u
    );
    assert.deepEqual(await readdir(source), []);
  });
});
