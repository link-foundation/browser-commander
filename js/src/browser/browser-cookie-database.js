let builtInSqlitePromise;

function loadBuiltInSqlite() {
  builtInSqlitePromise ??= import('node:sqlite')
    .then(({ DatabaseSync }) => DatabaseSync)
    .catch(() => null);
  return builtInSqlitePromise;
}

/** Open SQLite without requiring a native addon on Node versions that provide it. */
export async function openSqliteDatabase(
  filename,
  { fileMustExist = false, readOnly = false } = {}
) {
  const DatabaseSync = await loadBuiltInSqlite();
  if (DatabaseSync) {
    return new DatabaseSync(filename, { readOnly });
  }
  const BetterSqlite3 = await loadOptionalSqlite();
  return new BetterSqlite3(filename, {
    fileMustExist,
    readonly: readOnly,
  });
}

/** Configure a statement to preserve Chromium's 64-bit timestamp values. */
export function preserveIntegerPrecision(statement) {
  if (typeof statement.setReadBigInts === 'function') {
    statement.setReadBigInts(true);
  } else {
    statement.safeIntegers();
  }
  return statement;
}

/** Lazy native fallback for runtimes without built-in SQLite. */
export async function loadOptionalSqlite() {
  try {
    return (await import('better-sqlite3')).default;
  } catch (cause) {
    throw new Error(
      'This SQLite operation needs optional better-sqlite3 on this runtime. Install it or use Node >=22.16 for built-in SQLite backups.',
      { cause }
    );
  }
}

function backupProgress() {
  let remaining = Infinity;
  let lastProgress = Date.now();
  return ({ remainingPages }) => {
    if (remainingPages < remaining) {
      lastProgress = Date.now();
    } else if (Date.now() - lastProgress >= 1000) {
      throw new Error('SQLite backup made no progress');
    }
    remaining = remainingPages;
    return 256;
  };
}

/** Make an online backup, including committed WAL data. */
export async function backupSqliteDatabase(sourcePath, snapshotPath) {
  let native;
  try {
    native = await loadOptionalSqlite();
  } catch {
    /* built-in fallback */
  }
  let sqlite;
  try {
    sqlite = await import('node:sqlite');
  } catch {
    /* native fallback */
  }
  if (!native && sqlite?.backup) {
    const source = new sqlite.DatabaseSync(sourcePath, {
      readOnly: true,
      timeout: 1000,
    });
    try {
      source.prepare('PRAGMA schema_version').get();
      await sqlite.backup(source, snapshotPath, {
        rate: 256,
        progress: backupProgress(),
      });
    } finally {
      source.close();
    }
    return;
  }
  const BetterSqlite3 = native ?? (await loadOptionalSqlite());
  const source = new BetterSqlite3(sourcePath, {
    readonly: true,
    fileMustExist: true,
    timeout: 1000,
  });
  try {
    source.pragma('schema_version');
    await source.backup(snapshotPath, { progress: backupProgress() });
  } finally {
    source.close();
  }
}
