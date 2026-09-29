// feature-parity: attach.snapshot
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import BetterSqlite3 from 'better-sqlite3';

import {
  isSqliteFile,
  snapshotSkipReason,
  snapshotUserDataDir,
} from '../../../../src/browser/attach/snapshot.js';
import { removeUserDataDir } from '../../../../src/browser/profile-directory.js';
import {
  readProfileJson,
  writeChromiumHistory,
  writeProfileJson,
} from '../../../helpers/migration-fixtures.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-attach-snapshot-');

function snapshotChrome(root, to) {
  return snapshotUserDataDir({ browser: 'chrome', userDataDir: root, to });
}

/** Write `content` to `root/relativePath`, creating the parent folders. */
async function put(root, relativePath, content = relativePath) {
  const filePath = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

/**
 * A Chromium user data directory with one `Default` profile holding a mix of
 * data, caches, locks and session files, plus a second profile.
 */
async function makeUserDataDir() {
  const root = await makeTempDir();
  await put(root, 'Local State', JSON.stringify({ os_crypt: { key: 'k' } }));
  await put(root, 'SingletonLock');
  const profile = path.join(root, 'Default');
  await mkdir(profile);
  await writeProfileJson(profile, 'Preferences', {
    profile: { name: 'Person 1', exit_type: 'Crashed', exited_cleanly: false },
  });
  await writeProfileJson(profile, 'Bookmarks', { roots: {} });
  writeChromiumHistory(profile, 3);
  for (const item of [
    'LOCK',
    'Cache/Cache_Data/data_0',
    'Code Cache/js/index',
    'GPUCache/data_1',
    'Service Worker/CacheStorage/abc/index',
    'Service Worker/Database/000003.log',
    'Sessions/Session_1',
    'Current Session',
    'Local Storage/leveldb/000003.log',
    'Local Storage/leveldb/LOCK',
    'Cookies-journal',
  ]) {
    await put(profile, item);
  }
  await put(root, 'Profile 1/Preferences', '{}');
  return root;
}

/** Hash, size and mtime of every file under a directory. */
async function fingerprintTree(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const result = {};
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const filePath = path.join(entry.parentPath ?? entry.path, entry.name);
    const { mtimeMs, size } = await stat(filePath);
    const hash = createHash('sha256')
      .update(await readFile(filePath))
      .digest('hex');
    result[path.relative(root, filePath)] = { hash, mtimeMs, size };
  }
  return result;
}

function countRows(databasePath) {
  const database = new BetterSqlite3(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return database.prepare('SELECT COUNT(*) AS c FROM urls').get().c;
  } finally {
    database.close();
  }
}

describe('snapshotSkipReason', () => {
  it('names why locks, caches, crash reports, sessions and sidecars are skipped', () => {
    const cases = {
      SingletonLock: 'lock',
      SingletonSocket: 'lock',
      'Default/LOCK': 'lock',
      'Default/lockfile': 'lock',
      'Default/Cache': 'cache',
      'Default/Code Cache': 'cache',
      'Default/GPUCache': 'cache',
      'Default/DawnGraphiteCache': 'cache',
      'Default/Service Worker/CacheStorage': 'cache',
      Crashpad: 'crash-reports',
      'Default/Sessions': 'session',
      'Default/Current Tabs': 'session',
      'Default/Last Session': 'session',
      'Default/History-journal': 'sqlite-sidecar',
      'Default/Cookies-wal': 'sqlite-sidecar',
      'Default/Cookies-shm': 'sqlite-sidecar',
      'Default/History': null,
      'Default/Preferences': null,
      'Default/Service Worker/Database': null,
      'Default/Local Storage/leveldb/000003.log': null,
    };
    for (const [relativePath, reason] of Object.entries(cases)) {
      assert.equal(snapshotSkipReason(relativePath), reason, relativePath);
    }
  });
});

describe('snapshotUserDataDir', () => {
  it('copies Local State and the one profile, skipping locks and caches', async () => {
    const root = await makeUserDataDir();
    const to = path.join(await makeTempDir(), 'copy');

    const report = await snapshotChrome(root, to);

    assert.deepEqual(report.source, {
      browser: 'chrome',
      profile: 'Default',
      userDataDir: root,
    });
    assert.equal(report.target, to);
    assert.deepEqual(report.warnings, []);
    assert.equal(report.copied.databases, 1);
    assert.equal(
      await readFile(path.join(to, 'Local State'), 'utf8'),
      JSON.stringify({ os_crypt: { key: 'k' } })
    );
    assert.deepEqual(
      await readProfileJson(path.join(to, 'Default'), 'Bookmarks'),
      {
        roots: {},
      }
    );
    assert.equal(countRows(path.join(to, 'Default', 'History')), 3);
    assert.equal(await isSqliteFile(path.join(to, 'Default', 'History')), true);
    for (const kept of [
      'Default/Service Worker/Database/000003.log',
      'Default/Local Storage/leveldb/000003.log',
      'First Run',
    ]) {
      await stat(path.join(to, kept));
    }

    const skipped = Object.fromEntries(
      report.skipped.map(({ item, reason }) => [item, reason])
    );
    assert.deepEqual(skipped, {
      'Default/Cache': 'cache',
      'Default/Code Cache': 'cache',
      'Default/Cookies-journal': 'sqlite-sidecar',
      'Default/Current Session': 'session',
      'Default/GPUCache': 'cache',
      'Default/LOCK': 'lock',
      'Default/Local Storage/leveldb/LOCK': 'lock',
      'Default/Service Worker/CacheStorage': 'cache',
      'Default/Sessions': 'session',
    });
    for (const absent of [
      'SingletonLock',
      'Profile 1',
      'Default/Cache',
      'Default/Sessions',
      'Default/LOCK',
      'Default/Cookies-journal',
    ]) {
      await assert.rejects(stat(path.join(to, absent)), { code: 'ENOENT' });
    }
  });

  it('never modifies the source', async () => {
    const root = await makeUserDataDir();
    const before = await fingerprintTree(root);

    const report = await snapshotUserDataDir({
      browser: 'chrome',
      userDataDir: root,
      to: path.join(await makeTempDir(), 'copy'),
    });

    assert.deepEqual(await fingerprintTree(root), before);
    assert.ok(report.copied.files > 0);
  });

  it('marks only the copy as cleanly exited', async () => {
    const root = await makeUserDataDir();
    const to = path.join(await makeTempDir(), 'copy');

    await snapshotUserDataDir({ browser: 'edge', userDataDir: root, to });

    assert.deepEqual(
      (await readProfileJson(path.join(to, 'Default'), 'Preferences')).profile,
      { name: 'Person 1', exit_type: 'Normal', exited_cleanly: true }
    );
    assert.equal(
      (await readProfileJson(path.join(root, 'Default'), 'Preferences')).profile
        .exit_type,
      'Crashed'
    );
  });

  for (const journalMode of ['wal', 'delete']) {
    it(`snapshots a ${journalMode}-mode database while a write transaction holds it`, async () => {
      const root = await makeTempDir();
      const profile = path.join(root, 'Default');
      await mkdir(profile);
      const historyPath = writeChromiumHistory(profile, 5);
      const live = new BetterSqlite3(historyPath);
      try {
        live.pragma(`journal_mode = ${journalMode}`);
        // Keep committed rows in the WAL, as a running Chrome does.
        live.pragma('wal_autocheckpoint = 0');
        const insert = live.prepare('INSERT INTO urls (url) VALUES (?)');
        insert.run('https://committed.test/');
        live.exec('BEGIN IMMEDIATE');
        for (let index = 0; index < 50; index += 1) {
          insert.run(`https://uncommitted.test/${index}`);
        }
        const sourceFiles = [
          'History',
          `History-${journalMode === 'wal' ? 'wal' : 'journal'}`,
        ];
        const before = await Promise.all(
          sourceFiles.map((name) => readFile(path.join(profile, name)))
        );
        const to = path.join(await makeTempDir(), 'copy');

        const report = await snapshotChrome(root, to);

        const copy = path.join(to, 'Default', 'History');
        // One self-contained file: the committed WAL content is folded in.
        assert.deepEqual(await readdir(path.join(to, 'Default')), ['History']);
        assert.equal(report.copied.databases, 1);
        assert.equal(countRows(copy), 6);
        const database = new BetterSqlite3(copy, { readonly: true });
        try {
          assert.equal(
            database.pragma('integrity_check', { simple: true }),
            'ok'
          );
        } finally {
          database.close();
        }
        assert.ok(
          report.skipped.every(({ reason }) => reason === 'sqlite-sidecar'),
          JSON.stringify(report.skipped)
        );
        const after = await Promise.all(
          sourceFiles.map((name) => readFile(path.join(profile, name)))
        );
        assert.deepEqual(after, before);
      } finally {
        if (live.inTransaction) {
          live.exec('ROLLBACK');
        }
        live.close();
      }
    });
  }

  it(
    'reports symlinks and unreadable entries instead of failing',
    {
      skip:
        process.platform === 'win32' && 'symlinks and modes differ on Windows',
    },
    async () => {
      const root = await makeTempDir();
      const profile = path.join(root, 'Default');
      await put(profile, 'Preferences', '{}');
      const secret = await put(profile, 'Secret');
      await symlink(path.join(root, 'elsewhere'), path.join(profile, 'Link'));
      const runsAsRoot = process.getuid?.() === 0;
      await chmod(secret, 0o000);
      const to = path.join(await makeTempDir(), 'copy');

      try {
        const report = await snapshotUserDataDir({
          browser: 'chrome',
          userDataDir: root,
          to,
        });
        const reasons = Object.fromEntries(
          report.skipped.map(({ item, reason }) => [item, reason])
        );
        assert.equal(reasons['Default/Link'], 'symlink');
        if (!runsAsRoot) {
          assert.equal(reasons['Default/Secret'], 'unreadable');
        }
        assert.equal(report.warnings[0].reason, 'local-state-missing');
      } finally {
        await chmod(secret, 0o600);
      }
    }
  );

  it('creates a temporary target when none is given', async () => {
    const root = await makeUserDataDir();

    const report = await snapshotUserDataDir({
      browser: 'chrome',
      profile: 'Profile 1',
      userDataDir: root,
    });

    try {
      assert.equal(report.source.profile, 'Profile 1');
      await stat(path.join(report.target, 'Profile 1', 'Preferences'));
      await assert.rejects(stat(path.join(report.target, 'Default')), {
        code: 'ENOENT',
      });
    } finally {
      await removeUserDataDir(report.target);
    }
  });

  it('rejects Firefox, bad profile names and missing profiles', async () => {
    const root = await makeUserDataDir();

    await assert.rejects(
      snapshotUserDataDir({ browser: 'firefox', userDataDir: root }),
      /only supported for Chromium-family browsers/u
    );
    await assert.rejects(snapshotUserDataDir({}), TypeError);
    for (const profile of ['', '..', 'a/b', 'a\\b']) {
      await assert.rejects(
        snapshotUserDataDir({ browser: 'chrome', profile, userDataDir: root }),
        TypeError,
        profile
      );
    }
    await assert.rejects(
      snapshotUserDataDir({
        browser: 'chrome',
        profile: 'Profile 9',
        userDataDir: root,
      }),
      /No chrome profile "Profile 9"/u
    );
  });

  it('refuses a non-empty target and a target inside the source', async () => {
    const root = await makeUserDataDir();
    const busy = await makeTempDir();
    await put(busy, 'something');

    await assert.rejects(
      snapshotUserDataDir({ browser: 'chrome', userDataDir: root, to: busy }),
      /is not empty/u
    );
    await assert.rejects(
      snapshotUserDataDir({
        browser: 'chrome',
        userDataDir: root,
        to: path.join(root, 'copy'),
      }),
      /inside the source/u
    );
    await assert.rejects(stat(path.join(root, 'copy')), { code: 'ENOENT' });
  });
});
