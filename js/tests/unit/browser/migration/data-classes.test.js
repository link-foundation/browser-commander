import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { it } from 'node:test';

import {
  ALL_DATA_CLASSES,
  migrateProfile,
} from '../../../../src/browser/migration/index.js';
import { repoPath } from '../../../helpers/repo.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-data-classes-');
const classes = JSON.parse(
  await readFile(repoPath('tests/fixtures/migration-data-classes.json'), 'utf8')
);

it('requires an actual boolean for payment-card consent before target writes', async () => {
  const target = path.join(await makeTempDir(), 'new-profile');
  await assert.rejects(
    migrateProfile({
      from: { browser: 'chrome', userDataDir: await makeTempDir() },
      to: target,
      include: ['paymentCards'],
      includePaymentCards: 'true',
    }),
    /must be a boolean/u
  );
  await assert.rejects(readFile(path.join(target, 'Web Data')), {
    code: 'ENOENT',
  });
});

it('reports consented payment cards as unsupported until a native writer exists', async () => {
  const report = await migrateProfile({
    from: { browser: 'chrome', userDataDir: await makeTempDir() },
    to: path.join(await makeTempDir(), 'new-profile'),
    include: ['paymentCards'],
    includePaymentCards: true,
  });
  assert.equal(report.migrated.paymentCards, 0);
  assert.equal(report.skipped[0].reason, 'data-class-not-supported');
});

for (const browser of ['chrome', 'firefox', 'safari']) {
  it(`reports every selected additional data class for ${browser} without reading protected card data`, async () => {
    const source = await makeTempDir();
    const target = path.join(await makeTempDir(), 'new-profile');
    const profile =
      browser === 'chrome' ? path.join(source, 'Default') : source;
    await mkdir(profile, { recursive: true });
    const marker = Buffer.from(
      'protected card store must remain unread and unchanged'
    );
    await writeFile(path.join(profile, 'Web Data'), marker);
    const report = await migrateProfile({
      from: { browser, userDataDir: source },
      to: target,
      include: classes.slice(6),
      platform: 'darwin',
    });
    assert.deepEqual(ALL_DATA_CLASSES, classes);
    assert.deepEqual(Object.keys(report.migrated), classes);
    assert.ok(Object.values(report.migrated).every((count) => count === 0));
    for (const type of classes.slice(6)) {
      assert.ok(
        report.skipped.some((entry) => entry.type === type),
        type
      );
    }
    assert.equal(
      report.skipped.find(({ type }) => type === 'paymentCards').reason,
      'payment-card-consent-required'
    );
    const passkeys = report.skipped.filter(({ type }) => type === 'passkeys');
    assert.deepEqual(
      passkeys.map(({ item }) => item),
      ['iCloud Keychain', 'Google Password Manager', 'Windows Hello']
    );
    for (const entry of passkeys) {
      assert.equal(entry.reason, 'passkey-not-exportable');
      assert.match(entry.detail, /persistent profile/u);
    }
    await assert.rejects(readFile(path.join(target, 'Web Data')), {
      code: 'ENOENT',
    });
    assert.deepEqual(await readFile(path.join(profile, 'Web Data')), marker);
  });
}
