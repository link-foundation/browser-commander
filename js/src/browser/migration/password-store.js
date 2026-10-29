import { runCommand } from '../../utilities/subprocess.js';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  chmod,
  open,
} from 'node:fs/promises';
import path from 'node:path';
import {
  openSqliteDatabase,
  preserveIntegerPrecision,
  backupSqliteDatabase,
} from '../browser-cookie-database.js';
import { decryptChromiumCookie } from '../browser-cookie-crypto.js';
import { physicalPath } from '../browser-profile-files.js';
import { validateMigrationPaths } from './validation.js';

const identity = [
  'origin_url',
  'username_element',
  'username_value',
  'password_element',
  'signon_realm',
];
const tables = new Set([
  'logins',
  'meta',
  'password_notes',
  'insecure_credentials',
  'stats',
  'sync_entities_metadata',
  'sync_model_metadata',
  'incoming_sharing_invitation_sync_entities_metadata',
  'incoming_sharing_invitation_sync_model_metadata',
]);
const loginColumns = new Set(
  'id origin_url action_url username_element username_value password_element password_value submit_element signon_realm date_created blacklisted_by_user scheme password_type times_used form_data display_name icon_url federation_url skip_zero_click generation_upload_status possible_username_pairs date_last_used moving_blocked_for date_password_modified date_synced preferred ssl_valid possible_usernames use_additional_auth sender_email sender_name date_received sharing_notification_displayed sender_profile_image_url keychain_identifier date_last_filled actor_login_approved'.split(
    ' '
  )
);
const guidance =
  'Close the target browser and retry. For unsupported stores use a fresh dedicated profile; refresh cookies through the running browser cookie API.';

function refuse(reason) {
  throw new Error(`Password refresh refused (${reason}). ${guidance}`);
}

async function exists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function activeSidecar(file, suffix) {
  if (!(await exists(file))) {
    return false;
  }
  if (suffix !== '-journal' || (await lstat(file)).isSymbolicLink()) {
    return true;
  }
  // SQLite PERSIST journals remain after a clean close with a zeroed header.
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(8);
    await handle.read(header, 0, header.length, 0);
    return header.some((byte) => byte !== 0);
  } finally {
    await handle.close();
  }
}

/** Fail closed on browser locks, SQLite sidecars, and live dedicated browsers. */
export async function assertPasswordTargetClosed(targetProfileDir) {
  const dirs = [
    physicalPath(targetProfileDir),
    path.dirname(physicalPath(targetProfileDir)),
  ];
  for (const dir of dirs) {
    for (const name of [
      'SingletonLock',
      'SingletonCookie',
      'SingletonSocket',
      'lockfile',
    ]) {
      if (await exists(path.join(dir, name))) {
        refuse('target-active');
      }
    }
  }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (
      await activeSidecar(
        path.join(targetProfileDir, `Login Data${suffix}`),
        suffix
      )
    ) {
      refuse('target-active');
    }
  }
  let stdout;
  try {
    ({ stdout } = await runCommand(
      process.platform === 'win32' ? 'powershell.exe' : 'ps',
      process.platform === 'win32'
        ? [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine',
          ]
        : ['-axww', '-o', 'args=']
    ));
  } catch {
    refuse('target-state-unavailable');
  }
  for (const line of stdout.split(/\r?\n/u)) {
    const match = line.match(
      /(?:^|\s)(?:"--user-data-dir(?:=|\s+)([^"]+)"|--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(.+)))/u
    );
    if (!match) {
      continue;
    }
    const quoted = match.slice(1, 4).find((value) => value !== undefined);
    // ps drops argument quoting. Resolve each possible boundary so paths with
    // spaces and symlink aliases (including macOS /var) compare physically.
    const candidates = quoted
      ? [quoted]
      : Array.from(match[4].matchAll(/\s|$/gu), ({ index }) =>
          match[4].slice(0, index)
        );
    for (const value of candidates) {
      if (value && dirs.includes(physicalPath(value))) {
        refuse('target-active');
      }
    }
  }
}

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const rows = (db, sql, ...params) =>
  preserveIntegerPrecision(db.prepare(sql)).all(...params);
const columns = (db, table) =>
  db.prepare(`PRAGMA table_info(${quote(table)})`).all();

function validateSchema(source, target) {
  for (const db of [source, target]) {
    for (const row of db
      .prepare(
        "SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
      )
      .all()) {
      if (
        row.type === 'trigger' ||
        row.type === 'view' ||
        (row.type === 'table' && !tables.has(row.name))
      ) {
        refuse('unsupported-password-schema');
      }
    }
    const names = columns(db, 'logins').map((row) => row.name);
    if (
      identity.some((name) => !names.includes(name)) ||
      !names.includes('password_value') ||
      names.some((name) => !loginColumns.has(name))
    ) {
      refuse('unsupported-password-schema');
    }
    if (
      names.includes('keychain_identifier') &&
      db
        .prepare(
          'SELECT 1 FROM logins WHERE length(keychain_identifier)>0 LIMIT 1'
        )
        .get()
    ) {
      refuse('unsupported-password-schema');
    }
    // Preserve target version semantics rather than guessing at schema upgrades.
  }
  for (const table of ['logins', 'password_notes', 'insecure_credentials']) {
    if (
      JSON.stringify(columns(source, table)) !==
      JSON.stringify(columns(target, table))
    ) {
      refuse('unsupported-password-schema');
    }
  }
  const hasMeta = (db) => columns(db, 'meta').length > 0;
  if (hasMeta(source) !== hasMeta(target)) {
    refuse('unsupported-password-schema');
  }
  if (hasMeta(source)) {
    const versions = (db) =>
      rows(
        db,
        "SELECT key,value FROM meta WHERE key IN ('version','last_compatible_version') ORDER BY key"
      ).map((row) => [row.key, String(row.value)]);
    if (JSON.stringify(versions(source)) !== JSON.stringify(versions(target))) {
      refuse('unsupported-password-schema');
    }
  }
  for (const [table, allowed] of [
    [
      'password_notes',
      ['id', 'parent_id', 'key', 'value', 'date_created', 'confidential'],
    ],
    [
      'insecure_credentials',
      [
        'parent_id',
        'insecurity_type',
        'create_time',
        'is_muted',
        'trigger_notification_from_backend',
      ],
    ],
  ]) {
    const names = columns(target, table).map((row) => row.name);
    if (
      names.length &&
      (!names.includes('parent_id') ||
        !columns(target, 'logins').some((row) => row.name === 'id') ||
        names.some((name) => !allowed.includes(name)))
    ) {
      refuse('unsupported-password-schema');
    }
  }
  for (const table of ['logins', 'password_notes']) {
    const pk = columns(target, table).filter((row) => row.pk);
    if (
      pk.length &&
      (pk.length !== 1 ||
        pk[0].name !== 'id' ||
        pk[0].type.toUpperCase() !== 'INTEGER')
    ) {
      refuse('unsupported-password-schema');
    }
  }
}

function validateTargetKey(db, targetKey, platform) {
  for (const [table, column] of [
    ['logins', 'password_value'],
    ['password_notes', 'value'],
  ]) {
    if (!columns(db, table).length) {
      continue;
    }
    for (const row of rows(
      db,
      `SELECT ${quote(column)} AS value FROM ${quote(table)}`
    )) {
      if (!row.value?.length) {
        continue;
      }
      const encryptedValue = Buffer.from(row.value);
      const prefix = encryptedValue.subarray(0, 3).toString('ascii');
      if (!['v10', 'v11'].includes(prefix)) {
        refuse('target-encryption-unsupported');
      }
      try {
        decryptChromiumCookie({
          encryptedValue,
          host: '',
          databaseVersion: 0,
          platform,
          key: targetKey,
        });
      } catch {
        refuse('target-key-mismatch');
      }
    }
  }
}

function insertRow(db, table, row, omit = []) {
  const names = Object.keys(row).filter((name) => !omit.includes(name));
  return preserveIntegerPrecision(
    db.prepare(
      `INSERT INTO ${quote(table)} (${names.map(quote).join(',')}) VALUES (${names.map(() => '?').join(',')})`
    )
  ).run(...names.map((name) => row[name]));
}

function merge(source, target, report, targetKey, platform) {
  validateSchema(source, target);
  validateTargetKey(target, targetKey, platform);
  let migrated = 0;
  let inserted = 0;
  const hasId = columns(source, 'logins').some((row) => row.name === 'id');
  const find = target.prepare(
    `SELECT 1 FROM logins WHERE ${identity.map((name) => `${quote(name)} IS ?`).join(' AND ')}`
  );
  for (const row of rows(source, 'SELECT * FROM logins ORDER BY rowid')) {
    if (find.get(...identity.map((name) => row[name]))) {
      report.skipped.push({
        type: 'passwords',
        item: 'Login Data',
        reason: 'target-existing',
      });
      continue;
    }
    const { lastInsertRowid } = insertRow(target, 'logins', row, ['id']);
    inserted += 1;
    if (hasId) {
      for (const table of ['password_notes', 'insecure_credentials']) {
        if (!columns(source, table).length) {
          continue;
        }
        for (const child of rows(
          source,
          `SELECT * FROM ${table} WHERE parent_id=?`,
          row.id
        )) {
          insertRow(target, table, { ...child, parent_id: lastInsertRowid }, [
            'id',
          ]);
        }
      }
    }
    if (row.password_value?.length) {
      migrated += 1;
    }
  }
  // Target sync and stats rows belong to this profile and remain untouched.
  return { report: { ...report, migrated }, changed: inserted > 0 };
}

export async function preflightPasswordStore(
  sourceProfileDir,
  targetProfileDir
) {
  await assertPasswordTargetClosed(targetProfileDir);
  for (const dir of [sourceProfileDir, targetProfileDir].filter(Boolean)) {
    const account = path.join(dir, 'Login Data For Account');
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (await activeSidecar(`${account}${suffix}`, suffix)) {
        refuse('account-store-unsupported');
      }
    }
    if (!(await exists(account))) {
      continue;
    }
    let db;
    try {
      db = await openSqliteDatabase(account, { readOnly: true });
      const names = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all()
        .map((row) => row.name);
      if (
        !names.includes('logins') ||
        names.some((name) => !tables.has(name))
      ) {
        refuse('account-store-unsupported');
      }
      const loginNames = columns(db, 'logins').map((row) => row.name);
      if (
        [...identity, 'password_value'].some(
          (name) => !loginNames.includes(name)
        ) ||
        loginNames.some((name) => !loginColumns.has(name))
      ) {
        refuse('account-store-unsupported');
      }
      for (const table of [
        'logins',
        'password_notes',
        'insecure_credentials',
      ]) {
        if (
          names.includes(table) &&
          db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()
        ) {
          refuse('account-store-unsupported');
        }
      }
    } catch {
      refuse('account-store-unsupported');
    } finally {
      db?.close();
    }
  }
}

/** Prepare privately, merge on a target snapshot, then publish one complete file. */
export async function withPasswordStore({
  sourceProfileDir,
  targetProfileDir,
  targetKey,
  platform,
  prepare,
}) {
  if (sourceProfileDir) {
    validateMigrationPaths(sourceProfileDir, targetProfileDir);
  }
  await preflightPasswordStore(sourceProfileDir, targetProfileDir);
  const targetPath = path.join(targetProfileDir, 'Login Data');
  if (
    (await exists(targetPath)) &&
    (await lstat(targetPath)).isSymbolicLink()
  ) {
    refuse('unsupported-password-schema');
  }
  const original = (await exists(targetPath))
    ? await readFile(targetPath)
    : null;
  await mkdir(targetProfileDir, { recursive: true });
  const directory = await mkdtemp(
    path.join(targetProfileDir, '.password-refresh-')
  );
  const prepared = path.join(directory, 'source');
  let result;
  let lock;
  const lockPath = path.join(targetProfileDir, '.password-refresh.lock');
  try {
    try {
      lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') {
        refuse('target-busy');
      }
      throw error;
    }
    result = await prepare(prepared);
    let publish = prepared;
    let changed = true;
    if (original) {
      publish = path.join(directory, 'target');
      await backupSqliteDatabase(targetPath, publish);
      let source;
      let target;
      try {
        source = await openSqliteDatabase(prepared, { readOnly: true });
        target = await openSqliteDatabase(publish);
        ({ report: result, changed } = merge(
          source,
          target,
          result,
          targetKey,
          platform
        ));
      } catch (error) {
        if (error.message.startsWith('Password refresh refused')) {
          throw error;
        }
        refuse('unsupported-password-schema');
      } finally {
        source?.close();
        target?.close();
      }
    }
    await preflightPasswordStore(sourceProfileDir, targetProfileDir);
    const current = (await exists(targetPath))
      ? await readFile(targetPath)
      : null;
    if (original ? !current?.equals(original) : current !== null) {
      refuse('target-changed');
    }
    // A repeated refresh that inserts no records leaves even the file bytes intact.
    if (changed) {
      await chmod(publish, 0o600);
      await rename(publish, targetPath);
    }
    return result;
  } finally {
    if (lock) {
      await lock.close();
      await rm(lockPath, { force: true });
    }
    await rm(directory, { recursive: true, force: true });
  }
}
