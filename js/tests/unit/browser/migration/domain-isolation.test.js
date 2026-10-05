import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { useTempDirectories } from '../../../helpers/temp-directory.js';
import { migrateHistory } from '../../../../src/browser/migration/history.js';
import { migratePasswords } from '../../../../src/browser/migration/passwords.js';
import { encryptChromiumValue } from '../../../../src/browser/migration/chromium-crypto.js';
import {
  decryptChromiumCookie,
  deriveChromiumCookieKey,
} from '../../../../src/browser/browser-cookie-crypto.js';

const temp = useTempDirectories('bc-domain-isolation-');
describe('per-site domain isolation (#119)', () => {
  for (const domains of [['github.com'], []]) {
    it(`re-encrypts login notes and ${domains.length ? 'filters' : 'preserves'} domain metadata`, async () => {
      const source = await temp();
      const target = await temp();
      const sourceKey = randomBytes(16);
      const targetKey = randomBytes(16);
      const sourcePath = path.join(source, 'Login Data');
      const db = new Database(sourcePath);
      db.exec(
        await readFile(
          new URL(
            '../../../../../tests/fixtures/password-domain-isolation.sql',
            import.meta.url
          ),
          'utf8'
        )
      );
      const encrypted = (plaintext) =>
        encryptChromiumValue({
          plaintext,
          key: sourceKey,
          platform: 'linux',
          prefix: 'v11',
        });
      db.prepare('UPDATE logins SET password_value=? WHERE id IN (7,8)').run(
        encrypted('password')
      );
      const sourceNote = encrypted('private note ☃');
      db.prepare(
        'UPDATE password_notes SET value=? WHERE id IN (70,71,72)'
      ).run(sourceNote);
      db.close();
      const original = await readFile(sourcePath);
      const report = await migratePasswords({
        sourceProfileDir: source,
        targetProfileDir: target,
        domains,
        platform: 'linux',
        resolveSourceKey: () => sourceKey,
        targetKey,
      });
      const filtered = domains.length > 0;
      assert.equal(report.migrated, filtered ? 1 : 2);
      const copy = new Database(path.join(target, 'Login Data'));
      try {
        assert.deepEqual(
          copy.prepare('SELECT parent_id FROM insecure_credentials').all(),
          filtered ? [{ parent_id: 7 }] : [{ parent_id: 7 }, { parent_id: 8 }]
        );
        assert.deepEqual(
          copy.prepare('SELECT origin_domain FROM stats').all(),
          filtered
            ? [{ origin_domain: 'https://github.com' }]
            : [
                { origin_domain: 'https://github.com' },
                { origin_domain: 'https://notgithub.com' },
              ]
        );
        const notes = copy
          .prepare(
            'SELECT id,value,date_created,confidential FROM password_notes'
          )
          .all();
        assert.equal(notes.length, filtered ? 1 : 2);
        assert.equal(notes[0].id, 70);
        assert.equal(notes[0].date_created, 123);
        assert.equal(notes[0].confidential, 1);
        for (const note of notes) {
          assert.equal(
            decryptChromiumCookie({
              encryptedValue: note.value,
              databaseVersion: 0,
              platform: 'linux',
              key: targetKey,
            }),
            'private note ☃'
          );
        }
        for (const table of [
          'sync_entities_metadata',
          'sync_model_metadata',
          'future_password_metadata',
        ]) {
          const preserved = table === 'future_password_metadata' && !filtered;
          assert.equal(
            copy.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,
            preserved ? 1 : 0,
            table
          );
          assert.equal(
            report.warnings.some((warning) => warning.item === table),
            !preserved
          );
        }
        assert.ok(
          report.skipped.some(
            (entry) =>
              entry.item === 'password_notes/73' &&
              entry.reason === 'app-bound-v20'
          )
        );
      } finally {
        copy.close();
      }
      const bytes = await readFile(path.join(target, 'Login Data'));
      assert.equal(bytes.includes(Buffer.from('unrelated-sync-marker')), false);
      assert.equal(
        bytes.includes(Buffer.from('unrelated-future-marker')),
        !filtered
      );
      assert.equal(bytes.includes(sourceNote), false);
      assert.deepEqual(await readFile(sourcePath), original);
    });
  }

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
