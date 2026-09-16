/**
 * Writing a download into the managed directory (issue #88).
 *
 * The rule the whole module exists to keep: a file that appears under its
 * final name is complete and has passed validation. Everything else lives
 * under a `.partial` name and is removed.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { ARTIFACT_DIRECTORY_MODE, ARTIFACT_FILE_MODE } from './destination.js';
import {
  renamedCandidate,
  resolveInsideRoot,
  sanitizeDownloadName,
  withExtension,
} from './naming.js';

/** How a name that is already taken is resolved. */
export const DOWNLOAD_CONFLICT = Object.freeze({
  RENAME: 'rename',
  OVERWRITE: 'overwrite',
  ERROR: 'error',
});

/** How many bytes are kept to sniff a format from. */
const MAGIC_BYTES = 8;

/** Highest rename attempt before giving up rather than looping forever. */
const MAX_RENAME_ATTEMPTS = 1000;

/**
 * Open the download's bytes as a readable stream.
 *
 * @param {Object} source - Either `{stream}` or `{path}`
 * @returns {Object} Readable stream
 */
function openSource(source) {
  if (source.stream) {
    return source.stream;
  }
  if (source.path) {
    return createReadStream(source.path);
  }
  throw new TypeError('a download source needs either a stream or a path');
}

/**
 * Stream the download into a partial file, hashing it on the way through.
 *
 * Hashing during the copy means the bytes are read once: reading the file a
 * second time to checksum it would double the I/O and leave a window where the
 * file could change between the two reads.
 *
 * @param {Object} options - Copy options
 * @param {Object} options.source - `{stream}` or `{path}` to read from
 * @param {string} options.partialPath - Where the bytes are written
 * @returns {Promise<{bytes: number, checksum: string, head: Buffer}>} What was written
 */
async function copyToPartial({ source, partialPath }) {
  const hash = createHash('sha256');
  let bytes = 0;
  let head = Buffer.alloc(0);

  const readable = openSource(source);
  const writable = createWriteStream(partialPath, { mode: ARTIFACT_FILE_MODE });

  await pipeline(
    readable,
    async function* (chunks) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        bytes += chunk.length;
        if (head.length < MAGIC_BYTES) {
          head = Buffer.concat([head, chunk.subarray(0, MAGIC_BYTES)]).subarray(
            0,
            MAGIC_BYTES
          );
        }
        yield chunk;
      }
    },
    writable
  );

  return { bytes, checksum: hash.digest('hex'), head };
}

/**
 * Report whether a path already exists.
 *
 * @param {string} candidate - Absolute path
 * @returns {Promise<boolean>} Whether something is there
 */
async function exists(candidate) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Choose the final path for a completed download.
 *
 * @param {Object} options - Placement options
 * @param {string} options.root - Absolute download directory
 * @param {string} options.name - Sanitized file name
 * @param {string} options.conflict - Conflict policy
 * @returns {Promise<string>} Absolute final path
 * @throws {Error} When the name is taken and the policy says to fail
 */
export async function resolveFinalPath({ root, name, conflict }) {
  if (conflict === DOWNLOAD_CONFLICT.OVERWRITE) {
    return resolveInsideRoot(root, name);
  }

  for (let attempt = 0; attempt < MAX_RENAME_ATTEMPTS; attempt += 1) {
    const candidate = resolveInsideRoot(root, renamedCandidate(name, attempt));
    if (!(await exists(candidate))) {
      return candidate;
    }
    if (conflict === DOWNLOAD_CONFLICT.ERROR) {
      throw new Error(
        `refusing to replace ${candidate}: downloads.conflict is 'error'`
      );
    }
  }

  throw new Error(
    `could not find a free name for "${name}" after ${MAX_RENAME_ATTEMPTS} attempts`
  );
}

/**
 * Save a download into the managed directory.
 *
 * @param {Object} options - Save options
 * @param {string} options.root - Absolute download directory
 * @param {Object} options.source - `{stream}` or `{path}` to read from
 * @param {string} options.suggestedFilename - Name the page suggested
 * @param {string} [options.mimeType] - MIME type declared by the server
 * @param {string} [options.conflict] - Conflict policy
 * @param {Function} [options.filename] - Caller naming callback
 * @param {Function} [options.validate] - Validation run before the file is
 *   published; throwing or returning `false` rejects the download
 * @returns {Promise<{path: string, bytes: number, checksum: string}>} What was saved
 */
export async function saveDownload({
  root,
  source,
  suggestedFilename,
  mimeType,
  conflict = DOWNLOAD_CONFLICT.RENAME,
  filename,
  validate,
}) {
  await fs.mkdir(root, { recursive: true, mode: ARTIFACT_DIRECTORY_MODE });

  // A caller callback runs *before* sanitization, never instead of it: it is a
  // naming preference, not a grant of write access outside the root.
  const chosen = filename
    ? await filename({ suggestedFilename, mimeType })
    : suggestedFilename;
  const safeName = sanitizeDownloadName(chosen ?? suggestedFilename);

  const partialPath = resolveInsideRoot(
    root,
    `${safeName}.${process.pid}.${Date.now()}.partial`
  );

  let written;
  try {
    written = await copyToPartial({ source, partialPath });

    if (validate) {
      // Validation sees the partial file, so a rejected download never exists
      // under the name a caller would pick it up by.
      const verdict = await validate({
        path: partialPath,
        bytes: written.bytes,
        checksum: written.checksum,
        mimeType,
        suggestedFilename,
      });
      // A predicate that returns `false` rejects just as loudly as one that
      // throws; anything else (including `undefined`) accepts, so a validator
      // written only for its side effects still works.
      if (verdict === false) {
        throw new Error(
          `"${safeName}" was rejected by the caller's validation`
        );
      }
    }
  } catch (error) {
    await fs.rm(partialPath, { force: true });
    throw error;
  }

  const finalName = withExtension({
    name: safeName,
    mimeType,
    head: written.head,
  });

  try {
    const finalPath = await resolveFinalPath({
      root,
      name: finalName,
      conflict,
    });
    // Rename rather than copy: within one filesystem it is atomic, so a reader
    // watching the directory never sees a half-written file under this name.
    await fs.rename(partialPath, finalPath);
    await fs.chmod(finalPath, ARTIFACT_FILE_MODE);

    return {
      path: finalPath,
      bytes: written.bytes,
      checksum: written.checksum,
    };
  } catch (error) {
    await fs.rm(partialPath, { force: true });
    throw error;
  }
}

/**
 * Remove every partial file left behind in a download directory.
 *
 * @param {string} root - Absolute download directory
 * @returns {Promise<string[]>} Paths that were removed
 */
export async function cleanPartials(root) {
  let entries;
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const removed = [];
  for (const entry of entries) {
    if (entry.endsWith('.partial')) {
      const candidate = path.join(root, entry);
      await fs.rm(candidate, { force: true });
      removed.push(candidate);
    }
  }
  return removed;
}
