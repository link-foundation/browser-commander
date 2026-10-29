import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { withPasswordStore } from '../../../../src/browser/migration/password-store.js';
import path from 'node:path';
import { it } from 'node:test';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { migratePasswords } from '../../../../src/browser/migration/passwords.js';
import { encryptChromiumValue } from '../../../../src/browser/migration/chromium-crypto.js';
import { decryptChromiumCookie } from '../../../../src/browser/browser-cookie-crypto.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const temp = useTempDirectories();
const encrypt = (plaintext, key) =>
  encryptChromiumValue({ plaintext, key, platform: 'linux', prefix: 'v11' });
const schema = await readFile(
  new URL(
    '../../../../../tests/fixtures/password-refresh.sql',
    import.meta.url
  ),
  'utf8'
);

it('merges scoped passwords without replacing target logins or metadata and is idempotent', async () => {
  const [source, target] = await Promise.all([temp(), temp()]);
  const sourceKey = randomBytes(16);
  const targetKey = randomBytes(16);
  for (const [dir, key, rows] of [
    [
      source,
      sourceKey,
      [
        [1, 'https://login.live.com', 'shared', 'source-conflict'],
        [2, 'https://new.live.com', 'new', 'new-secret'],
        [3, 'https://notlive.com', 'excluded', 'excluded-secret'],
      ],
    ],
    [
      target,
      targetKey,
      [
        [1, 'https://example.test', 'unrelated', 'unrelated-secret'],
        [2, 'https://login.live.com', 'shared', 'target-conflict'],
        [3, 'https://only.live.com', 'only', 'target-only'],
      ],
    ],
  ]) {
    const db = new Database(path.join(dir, 'Login Data'));
    db.exec(schema);
    for (const [id, origin, username, secret] of rows) {
      db.prepare('INSERT INTO logins VALUES (?,?,?,?,?,?,?,?,?)').run(
        id,
        origin,
        '',
        username,
        '',
        `${origin}/`,
        encrypt(secret, key),
        13300000000000001n,
        13300000000000002n
      );
    }
    db.prepare('INSERT INTO password_notes VALUES (1,2,?,?,123,1)').run(
      'note',
      encrypt(dir === source ? 'source-note' : 'target-note', key)
    );
    db.exec(
      "INSERT INTO insecure_credentials VALUES (2,0); INSERT INTO sync_model_metadata VALUES (1,'private-sync-state')"
    );
    db.close();
  }
  const original = await readFile(path.join(source, 'Login Data'));
  const run = () =>
    migratePasswords({
      sourceProfileDir: source,
      targetProfileDir: target,
      platform: 'linux',
      resolveSourceKey: () => sourceKey,
      targetKey,
      domains: ['live.com'],
    });
  const first = await run();
  assert.equal(first.migrated, 1);
  assert.ok(first.skipped.some((entry) => entry.reason === 'target-existing'));
  const inspect = () => {
    const db = new Database(path.join(target, 'Login Data'));
    try {
      const rows = db
        .prepare('SELECT * FROM logins ORDER BY origin_url')
        .safeIntegers()
        .all();
      assert.equal(rows.length, 4);
      assert.deepEqual(
        rows.map((row) =>
          decryptChromiumCookie({
            encryptedValue: row.password_value,
            host: '',
            databaseVersion: 0,
            platform: 'linux',
            key: targetKey,
          })
        ),
        ['unrelated-secret', 'target-conflict', 'new-secret', 'target-only']
      );
      assert.equal(rows[2].date_created, 13300000000000001n);
      const notes = db
        .prepare(
          'SELECT logins.origin_url,password_notes.value FROM password_notes JOIN logins ON logins.id=password_notes.parent_id ORDER BY logins.origin_url'
        )
        .all();
      assert.deepEqual(
        notes.map((row) => [
          row.origin_url,
          decryptChromiumCookie({
            encryptedValue: row.value,
            host: '',
            databaseVersion: 0,
            platform: 'linux',
            key: targetKey,
          }),
        ]),
        [
          ['https://login.live.com', 'target-note'],
          ['https://new.live.com', 'source-note'],
        ]
      );
      assert.deepEqual(
        db
          .prepare(
            'SELECT origin_url FROM insecure_credentials JOIN logins ON logins.id=insecure_credentials.parent_id ORDER BY origin_url'
          )
          .all()
          .map((row) => row.origin_url),
        ['https://login.live.com', 'https://new.live.com']
      );
      assert.equal(
        db.prepare('SELECT count(*) AS n FROM password_notes').get().n,
        2
      );
      assert.equal(
        db.prepare('SELECT count(*) AS n FROM insecure_credentials').get().n,
        2
      );
      assert.equal(
        db.prepare('SELECT model_metadata FROM sync_model_metadata').get()
          .model_metadata,
        'private-sync-state'
      );
      return rows;
    } finally {
      db.close();
    }
  };
  const before = inspect();
  const bytes = await readFile(path.join(target, 'Login Data'));
  const second = await run();
  assert.equal(second.migrated, 0);
  assert.deepEqual(inspect(), before);
  assert.deepEqual(await readFile(path.join(target, 'Login Data')), bytes);
  assert.deepEqual(await readFile(path.join(source, 'Login Data')), original);
  for (const report of [first, second]) {
    assert.doesNotMatch(
      JSON.stringify(report),
      /shared|source-conflict|new-secret|target-note|private-sync-state/
    );
  }
});

for (const kind of [
  'active',
  'schema',
  'metadata',
  'version',
  'trigger',
  'wal',
  'journal',
  'account-source',
  'account-target',
  'key',
]) {
  it(`refuses ${kind} before changing target bytes`, async () => {
    const source = await temp();
    const target = await temp();
    const key = randomBytes(16);
    for (const directory of [source, target]) {
      const db = new Database(path.join(directory, 'Login Data'));
      db.exec(schema);
      const encrypted = encryptChromiumValue({
        plaintext: 'secret',
        key,
        platform: 'linux',
        prefix: 'v11',
      });
      db.prepare(
        "INSERT INTO logins VALUES (1,'https://login.live.com','','private-user','','https://login.live.com/',?,0,0)"
      ).run(encrypted);
      if (kind === 'metadata' && directory === target) {
        db.exec('ALTER TABLE password_notes ADD COLUMN opaque_secret BLOB');
      }
      if (kind === 'version' && directory === target) {
        db.exec("UPDATE meta SET value='999' WHERE key='version'");
      }
      if (kind === 'trigger' && directory === target) {
        db.exec(
          'CREATE TRIGGER unexpected AFTER INSERT ON logins BEGIN DELETE FROM password_notes; END'
        );
      }
      if (kind === 'schema' && directory === target) {
        db.exec('ALTER TABLE logins ADD COLUMN opaque_secret BLOB');
      }
      if (kind === 'key' && directory === target) {
        db.exec("UPDATE logins SET password_value=X'76313101'");
      }
      db.close();
    }
    if (kind === 'active') {
      await writeFile(path.join(target, 'SingletonLock'), '');
    }
    if (kind === 'wal' || kind === 'journal') {
      await writeFile(
        path.join(target, `Login Data-${kind}`),
        'active journal'
      );
    }
    if (kind.startsWith('account')) {
      await writeFile(
        path.join(
          kind === 'account-source' ? source : target,
          'Login Data For Account'
        ),
        ''
      );
    }
    const before = await readFile(path.join(target, 'Login Data'));
    await assert.rejects(
      migratePasswords({
        sourceProfileDir: source,
        targetProfileDir: target,
        platform: 'linux',
        resolveSourceKey: () => key,
        targetKey: key,
        domains: ['live.com'],
      }),
      /Password refresh refused/u
    );
    assert.deepEqual(await readFile(path.join(target, 'Login Data')), before);
  });
}

it('refuses a target browser process even without lock markers', async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { assertPasswordTargetClosed } =
    await import('../../../../src/browser/migration/password-store.js');
  const { mkdir, symlink } = await import('node:fs/promises');
  const root = await temp();
  const target = path.join(root, 'profile with spaces');
  await mkdir(target);
  // macOS's /var aliases /private/var. Exercise that path mismatch everywhere.
  let browserTarget = target;
  if (process.platform !== 'win32') {
    const alias = path.join(root, 'alias');
    await symlink(root, alias, 'dir');
    browserTarget = path.join(alias, 'profile with spaces');
  }
  const child = spawn(
    process.execPath,
    [
      '-e',
      'setTimeout(() => {}, 15000)',
      '--',
      `--user-data-dir=${browserTarget}`,
    ],
    { stdio: 'ignore' }
  );
  try {
    await once(child, 'spawn');
    await assert.rejects(assertPasswordTargetClosed(target), /target-active/u);
  } finally {
    const closed = once(child, 'exit');
    child.kill();
    await closed;
  }
});

it('accepts empty account stores and zeroed persistent journals without changing them', async () => {
  const { writeChromiumPasswords } =
    await import('../../../../src/browser/migration/firefox.js');
  const target = await temp();
  const account = path.join(target, 'Login Data For Account');
  const db = new Database(account);
  db.exec(schema);
  db.close();
  const before = await readFile(account);
  await writeFile(`${account}-journal`, Buffer.alloc(512));
  await writeFile(path.join(target, 'Login Data-journal'), Buffer.alloc(512));
  const report = await writeChromiumPasswords({
    targetProfileDir: target,
    platform: 'linux',
    targetKey: randomBytes(16),
    entries: [
      {
        origin: 'https://login.live.com',
        username: 'fixture-user',
        password: 'fixture-secret',
      },
    ],
  });
  assert.equal(report.migrated, 1);
  assert.deepEqual(await readFile(account), before);
  assert.deepEqual(await readFile(`${account}-journal`), Buffer.alloc(512));
});

it('refuses populated account stores while preserving both target databases', async () => {
  const { copyFile } = await import('node:fs/promises');
  const { writeChromiumPasswords } =
    await import('../../../../src/browser/migration/firefox.js');
  const target = await temp();
  const key = randomBytes(16);
  const write = () =>
    writeChromiumPasswords({
      targetProfileDir: target,
      platform: 'linux',
      targetKey: key,
      entries: [
        {
          origin: 'https://login.live.com',
          username: 'fixture-user',
          password: 'fixture-secret',
        },
      ],
    });
  await write();
  const main = path.join(target, 'Login Data');
  const account = path.join(target, 'Login Data For Account');
  await copyFile(main, account);
  const before = await readFile(main);
  await assert.rejects(write(), /account-store-unsupported/u);
  assert.deepEqual(await readFile(main), before);
  assert.deepEqual(await readFile(account), before);
});

it('refuses concurrent writers and detects a target changed during preparation', async () => {
  const target = await temp();
  const file = path.join(target, 'Login Data');
  const options = {
    targetProfileDir: target,
    targetKey: randomBytes(16),
    platform: 'linux',
  };
  await assert.rejects(
    withPasswordStore({
      ...options,
      prepare: async () => {
        await assert.rejects(
          withPasswordStore({
            ...options,
            prepare: () => assert.fail('concurrent writer prepared'),
          }),
          /target-busy/u
        );
        await writeFile(file, 'concurrent change');
        return { migrated: 0, skipped: [], warnings: [] };
      },
    }),
    /target-changed/u
  );
  assert.equal(await readFile(file, 'utf8'), 'concurrent change');
});

it('checks password safety before other selected classes change the target', async () => {
  const { migrateProfile } =
    await import('../../../../src/browser/migration/index.js');
  const source = await temp();
  const target = await temp();
  const db = new Database(path.join(source, 'Login Data'));
  db.exec(schema);
  db.close();
  await writeFile(path.join(source, 'Bookmarks'), '{"roots":{}}');
  await writeFile(path.join(target, 'Bookmarks'), 'target bookmarks');
  await writeFile(path.join(target, 'SingletonLock'), '');
  await assert.rejects(
    migrateProfile({
      from: { browser: 'opera', userDataDir: source },
      to: target,
      include: ['bookmarks', 'passwords'],
      keys: {
        targetKey: randomBytes(16),
        resolveSourceKey: () => randomBytes(16),
      },
    }),
    /target-active/u
  );
  assert.equal(
    await readFile(path.join(target, 'Bookmarks'), 'utf8'),
    'target bookmarks'
  );
});

it('keeps a target unchanged when password preparation fails', async () => {
  const target = await temp();
  await writeFile(path.join(target, 'Login Data'), 'original target');
  await assert.rejects(
    withPasswordStore({
      targetProfileDir: target,
      targetKey: randomBytes(16),
      platform: 'linux',
      prepare: async (file) => {
        await writeFile(file, 'partial stage');
        throw new Error('preparation failure');
      },
    }),
    /preparation failure/u
  );
  assert.equal(
    await readFile(path.join(target, 'Login Data'), 'utf8'),
    'original target'
  );
});

it('merges repeated translated Firefox and Safari password writes', async () => {
  const { writeChromiumPasswords } =
    await import('../../../../src/browser/migration/firefox.js');
  const target = await temp();
  const key = randomBytes(16);
  const write = (password) =>
    writeChromiumPasswords({
      targetProfileDir: target,
      platform: 'linux',
      targetKey: key,
      targetPrefix: 'v11',
      entries: [
        { origin: 'https://login.live.com', username: 'local-user', password },
      ],
    });
  assert.equal((await write('first-secret')).migrated, 1);
  const before = await readFile(path.join(target, 'Login Data'));
  const report = await write('second-secret');
  assert.equal(report.migrated, 0);
  assert.equal(report.skipped[0].reason, 'target-existing');
  assert.deepEqual(await readFile(path.join(target, 'Login Data')), before);
});
