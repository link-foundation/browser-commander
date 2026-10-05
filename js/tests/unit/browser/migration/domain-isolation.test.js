import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { useTempDirectories } from '../../../helpers/temp-directory.js';
import { migrateHistory } from '../../../../src/browser/migration/history.js';
import { migratePasswords } from '../../../../src/browser/migration/passwords.js';
import { encryptChromiumValue } from '../../../../src/browser/migration/chromium-crypto.js';
import { deriveChromiumCookieKey } from '../../../../src/browser/browser-cookie-crypto.js';

const temp = useTempDirectories('bc-domain-isolation-');
describe('per-site domain isolation (#119)', () => {
  it('excludes unrelated history URLs, their visits, and Top Sites', async () => {
    const source = await temp();
    const target = await temp();
    const db = new Database(path.join(source, 'History'));
    db.exec(
      await readFile(
        new URL(
          '../../../../../tests/fixtures/history-domain-isolation.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    db.close();
    await migrateHistory({
      sourceProfileDir: source,
      targetProfileDir: target,
      domains: ['github.com'],
    });
    const copy = new Database(path.join(target, 'History'));
    try {
      assert.equal(copy.prepare('SELECT count(*) AS n FROM urls').get().n, 1);
      assert.equal(copy.prepare('SELECT count(*) AS n FROM visits').get().n, 1);
      for (const table of [
        'content_annotations',
        'context_annotations',
        'segment_usage',
        'downloads',
        'downloads_url_chains',
        'downloads_slices',
      ]) {
        assert.equal(
          copy.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,
          1,
          table
        );
      }
    } finally {
      copy.close();
    }
  });

  it('filters passwords before decryption and removes undecryptable source values', async () => {
    const source = await temp();
    const target = await temp();
    const key = deriveChromiumCookieKey('source', 'linux');
    const db = new Database(path.join(source, 'Login Data'));
    db.exec('CREATE TABLE logins(origin_url TEXT, password_value BLOB)');
    const insert = db.prepare('INSERT INTO logins VALUES (?,?)');
    insert.run(
      'https://github.com',
      encryptChromiumValue({
        plaintext: 'secret',
        key,
        platform: 'linux',
        prefix: 'v11',
      })
    );
    insert.run('https://notgithub.com', Buffer.from('v20unreadable'));
    insert.run('https://locked.github.com', Buffer.from('v20unreadable'));
    db.close();
    const report = await migratePasswords({
      sourceProfileDir: source,
      targetProfileDir: target,
      domains: ['github.com'],
      platform: 'linux',
      resolveSourceKey: () => key,
      targetKey: key,
    });
    assert.equal(report.migrated, 1);
    const copy = new Database(path.join(target, 'Login Data'));
    try {
      assert.deepEqual(copy.prepare('SELECT origin_url FROM logins').all(), [
        { origin_url: 'https://github.com' },
      ]);
    } finally {
      copy.close();
    }
  });
});
