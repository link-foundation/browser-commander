import {
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import BetterSqlite3 from 'better-sqlite3';

import {
  browserProfileRoot,
  normalizeCookieBrowser,
} from '../browser-profiles.js';
import { pathExists } from '../migration/fs-utils.js';
import { withDatabaseSnapshot } from '../migration/sqlite-snapshot.js';
import {
  createTemporaryUserDataDir,
  LOCAL_STATE_FILE,
  prepareUserDataDir,
  removeUserDataDir,
} from '../profile-directory.js';

/**
 * Snapshot of the real data folder (issue #102, addendum, mode 1).
 *
 * Chrome 136 and later ignore `--remote-debugging-port` for the default user
 * data directory, so the closest thing to "the real folder" that CDP allows is
 * a copy of it in a temporary user data directory. The copy is made read-only
 * from the source, also while the source browser runs:
 *
 * 1. `Local State` (profile-wide settings and, on Windows, the cookie and
 *    password key) is copied from `<root>/Local State` to `<target>/Local
 *    State`.
 * 2. The one profile directory `<root>/<profile>` is copied to
 *    `<target>/<profile>` recursively, keeping the relative layout, so the
 *    target is a user data directory with that profile.
 * 3. Entries matching {@link snapshotSkipReason} are not copied and are listed
 *    in `skipped`: lock files and sockets, caches, crash reports, the open-tabs
 *    session files, and SQLite `-journal`/`-wal`/`-shm` sidecars (the backup
 *    snapshot already contains their committed content). Symbolic links and
 *    special files are never followed or copied.
 * 4. A file whose first 16 bytes are the SQLite header `SQLite format 3\0` is
 *    copied through the SQLite Online Backup API snapshot
 *    (`withDatabaseSnapshot`), which is consistent even while the browser
 *    writes to it; every other file is a plain byte copy.
 * 5. A file or directory that cannot be read is listed in `skipped` with
 *    reason `unreadable` and the error message; it never fails the snapshot.
 * 6. The target gets Chrome's `First Run` sentinel (and the initial Local
 *    State when the source had none), and in the copied `Preferences`
 *    `profile.exit_type` is set to `Normal` and `profile.exited_cleanly` to
 *    true, because a running browser records itself as crashed until it
 *    exits and the copy would otherwise show the "restore pages" bubble.
 *
 * Nothing is ever written to the source. Only Chromium-family browsers
 * (chrome, chromium, edge, brave) are supported.
 */

/** The 16-byte header every SQLite 3 database file starts with. */
export const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

/** Directory names (at any depth) that are caches. */
const CACHE_NAMES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
]);

/** Open-tabs session state; the launch opens its own start page. */
const SESSION_NAMES = new Set([
  'Sessions',
  'Current Session',
  'Current Tabs',
  'Last Session',
  'Last Tabs',
]);

const SQLITE_SIDECAR_SUFFIXES = ['-journal', '-wal', '-shm'];

/**
 * Why an entry is not copied, or null when it is.
 *
 * @param {string} relativePath - Path relative to the source root, with `/`
 *   separators (for example `Default/Service Worker/CacheStorage`)
 * @returns {('lock'|'cache'|'crash-reports'|'session'|'sqlite-sidecar'|null)}
 */
export function snapshotSkipReason(relativePath) {
  const name = relativePath.split('/').at(-1);
  if (name.startsWith('Singleton') || name === 'lockfile' || name === 'LOCK') {
    return 'lock';
  }
  if (
    CACHE_NAMES.has(name) ||
    relativePath.endsWith('Service Worker/CacheStorage')
  ) {
    return 'cache';
  }
  if (name === 'Crashpad') {
    return 'crash-reports';
  }
  if (SESSION_NAMES.has(name)) {
    return 'session';
  }
  if (SQLITE_SIDECAR_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
    return 'sqlite-sidecar';
  }
  return null;
}

/**
 * True when a file starts with the SQLite 3 header.
 *
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function isSqliteFile(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.equals(SQLITE_HEADER);
  } finally {
    await handle.close();
  }
}

function assertProfileName(profile) {
  if (
    typeof profile !== 'string' ||
    profile === '' ||
    profile === '.' ||
    profile === '..' ||
    /[/\\]/u.test(profile)
  ) {
    throw new TypeError(
      `profile must be a profile directory name such as "Default" or "Profile 1", got ${JSON.stringify(profile)}`
    );
  }
}

function isInside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

async function prepareTarget(to, sourceRoot, profile) {
  if (!to) {
    return await createTemporaryUserDataDir({ profileDirectory: profile });
  }
  if (isInside(to, sourceRoot)) {
    throw new Error(
      `The snapshot target ${to} is inside the source ${sourceRoot}`
    );
  }
  await mkdir(to, { recursive: true });
  if ((await readdir(to)).length > 0) {
    throw new Error(`The snapshot target ${to} is not empty`);
  }
  return to;
}

/**
 * Copy a database snapshot to its place in the target. The Online Backup API
 * snapshot is a single self-contained file; the locked-file fallback is a copy
 * with its `-wal`/`-journal` sidecars, which is folded into one file with
 * another backup (of the temporary copy, never of the source).
 */
async function copyDatabase(snapshotPath, destination) {
  const hasSidecar =
    (await pathExists(`${snapshotPath}-wal`)) ||
    (await pathExists(`${snapshotPath}-journal`));
  if (!hasSidecar) {
    await copyFile(snapshotPath, destination);
    return;
  }
  const database = new BetterSqlite3(snapshotPath, { fileMustExist: true });
  try {
    await database.backup(destination);
  } finally {
    database.close();
  }
}

/** Copy the directory tree below one entry, recording the outcome. */
class SnapshotCopier {
  constructor(sourceRoot, target) {
    this.sourceRoot = sourceRoot;
    this.target = target;
    this.copied = { files: 0, databases: 0 };
    this.skipped = [];
  }

  skip(item, reason, detail) {
    this.skipped.push(detail ? { item, reason, detail } : { item, reason });
  }

  async copyFile(relativePath) {
    const source = path.join(this.sourceRoot, ...relativePath.split('/'));
    const destination = path.join(this.target, ...relativePath.split('/'));
    try {
      if (await isSqliteFile(source)) {
        await withDatabaseSnapshot({
          sourcePath: source,
          read: (snapshotPath) => copyDatabase(snapshotPath, destination),
        });
        this.copied.databases += 1;
      } else {
        await copyFile(source, destination);
        this.copied.files += 1;
      }
    } catch (error) {
      this.skip(relativePath, 'unreadable', error.message);
    }
  }

  async copyDirectory(relativePath) {
    let entries;
    try {
      entries = await readdir(
        path.join(this.sourceRoot, ...relativePath.split('/')),
        { withFileTypes: true }
      );
    } catch (error) {
      this.skip(relativePath, 'unreadable', error.message);
      return;
    }
    await mkdir(path.join(this.target, ...relativePath.split('/')), {
      recursive: true,
    });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      await this.copyEntry(`${relativePath}/${entry.name}`, entry);
    }
  }

  async copyEntry(relativePath, entry) {
    const reason = snapshotSkipReason(relativePath);
    if (reason) {
      this.skip(relativePath, reason);
    } else if (entry.isSymbolicLink()) {
      this.skip(relativePath, 'symlink');
    } else if (entry.isDirectory()) {
      await this.copyDirectory(relativePath);
    } else if (entry.isFile()) {
      await this.copyFile(relativePath);
    } else {
      this.skip(relativePath, 'special-file');
    }
  }
}

/**
 * Mark the copied profile as cleanly exited, so the copy of a running browser
 * does not offer to restore pages. The source is never touched.
 */
async function markExitedCleanly(profileDir) {
  const preferencesPath = path.join(profileDir, 'Preferences');
  let preferences;
  try {
    preferences = JSON.parse(await readFile(preferencesPath, 'utf8'));
  } catch {
    return;
  }
  if (!preferences || typeof preferences !== 'object') {
    return;
  }
  preferences.profile = {
    ...(preferences.profile ?? {}),
    exit_type: 'Normal',
    exited_cleanly: true,
  };
  await writeFile(preferencesPath, JSON.stringify(preferences));
}

/**
 * Copy a real Chromium profile into a user data directory that can be
 * launched with remote debugging.
 *
 * @param {Object} options
 * @param {string} options.browser - chrome, chromium, edge (msedge) or brave
 * @param {string} [options.profile='Default'] - Profile directory name
 * @param {string} [options.userDataDir] - Source user data directory; defaults to the browser's real one
 * @param {string} [options.to] - Target user data directory (created; must be empty); defaults to a new temporary one
 * @param {string} [options.platform=process.platform]
 * @param {string} [options.homeDir=os.homedir()]
 * @param {Object<string,string>} [options.environment=process.env]
 * @returns {Promise<{source: {browser: string, profile: string, userDataDir: string}, target: string, copied: {files: number, databases: number}, skipped: Array<{item: string, reason: string, detail: (string|undefined)}>, warnings: Array<{item: string, reason: string, detail: string}>}>}
 */
export async function snapshotUserDataDir({
  browser,
  profile = 'Default',
  userDataDir,
  to,
  platform = process.platform,
  homeDir = os.homedir(),
  environment = process.env,
} = {}) {
  if (!browser) {
    throw new TypeError('snapshotUserDataDir requires a browser');
  }
  const normalizedBrowser = normalizeCookieBrowser(browser);
  if (normalizedBrowser === 'firefox') {
    throw new Error(
      'A profile snapshot is only supported for Chromium-family browsers (chrome, chromium, edge, brave): Firefox cannot be driven over CDP by this launcher'
    );
  }
  assertProfileName(profile);
  const sourceRoot =
    userDataDir ??
    browserProfileRoot(normalizedBrowser, { platform, homeDir, environment });
  const sourceProfile = path.join(sourceRoot, profile);
  const profileStat = await stat(sourceProfile).catch(() => null);
  if (!profileStat?.isDirectory()) {
    throw new Error(
      `No ${normalizedBrowser} profile "${profile}" found at ${sourceProfile}`
    );
  }

  const target = await prepareTarget(to, sourceRoot, profile);
  try {
    return await copyProfile({
      sourceRoot,
      profile,
      target,
      source: { browser: normalizedBrowser, profile, userDataDir: sourceRoot },
    });
  } catch (error) {
    if (!to) {
      await removeUserDataDir(target);
    }
    throw error;
  }
}

async function copyProfile({ sourceRoot, profile, target, source }) {
  const copier = new SnapshotCopier(sourceRoot, target);
  const warnings = [];
  const localState = await stat(path.join(sourceRoot, LOCAL_STATE_FILE)).catch(
    () => null
  );
  if (localState?.isFile()) {
    await copier.copyFile(LOCAL_STATE_FILE);
  } else {
    warnings.push({
      item: LOCAL_STATE_FILE,
      reason: 'local-state-missing',
      detail:
        'The source has no Local State; on Windows it holds the key cookies and passwords are encrypted with, so they cannot be decrypted in the copy.',
    });
  }
  await copier.copyDirectory(profile);
  await prepareUserDataDir(target, { profileDirectory: profile });
  await markExitedCleanly(path.join(target, profile));

  return {
    source,
    target,
    copied: copier.copied,
    skipped: copier.skipped,
    warnings,
  };
}
