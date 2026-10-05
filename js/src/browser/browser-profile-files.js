import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

/** Opera keeps Local State inside its single-profile root. */
export function localStatePathForProfile(profileDir) {
  const own = path.join(profileDir, 'Local State');
  return existsSync(own)
    ? own
    : path.join(path.dirname(profileDir), 'Local State');
}

/** Resolve existing ancestors even when the target profile does not exist. */
export function physicalPath(value) {
  let existing = path.resolve(value);
  const suffix = [];
  while (true) {
    try {
      return path.join(realpathSync(existing), ...suffix.reverse());
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) {
        throw error;
      }
      suffix.push(path.basename(existing));
      const parent = path.dirname(existing);
      if (parent === existing) {
        throw error;
      }
      existing = parent;
    }
  }
}
