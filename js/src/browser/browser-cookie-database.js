import BetterSqlite3 from 'better-sqlite3';

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
