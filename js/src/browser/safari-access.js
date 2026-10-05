import { stat } from 'node:fs/promises';

/** A protected path remains a source, so reads can explain Full Disk Access. */
export async function findSafariFile(candidates, statFile = stat) {
  for (const candidate of candidates) {
    try {
      if ((await statFile(candidate)).isFile()) {
        return candidate;
      }
    } catch (error) {
      if (['EPERM', 'EACCES'].includes(error.code)) {
        return candidate;
      }
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) {
        throw error;
      }
    }
  }
  return null;
}

/** Enrich protection failures for every Safari store, preserving the cause. */
export async function withSafariAccess(
  filename,
  read,
  environment = process.env
) {
  try {
    return await read();
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) {
      throw error;
    }
    const app =
      environment.__CFBundleIdentifier ||
      environment.TERM_PROGRAM ||
      process.execPath;
    const diagnostic = new Error(
      `Safari access denied (${error.code}) at ${filename}. Grant Full Disk Access to ${app}, the app running Browser Commander, then retry: x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`,
      { cause: error }
    );
    diagnostic.code = error.code;
    throw diagnostic;
  }
}
