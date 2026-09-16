/**
 * Naming and placement rules for managed downloads (issue #88).
 *
 * Everything here answers one question: given a name a *page* chose, where is
 * it safe to write the bytes? A suggested filename is attacker-controlled
 * input, so it is treated as a hint and never as a path.
 */

import path from 'node:path';

/** The type a server sends when it cannot name the format either. */
const GENERIC_BINARY_TYPE = 'application/octet-stream';

/** Extensions derived from a declared or detected MIME type. */
const MIME_EXTENSIONS = new Map([
  ['application/pdf', '.pdf'],
  ['application/json', '.json'],
  ['application/zip', '.zip'],
  ['application/gzip', '.gz'],
  ['application/x-tar', '.tar'],
  [GENERIC_BINARY_TYPE, '.bin'],
  ['application/vnd.ms-excel', '.xls'],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xlsx',
  ],
  ['application/msword', '.doc'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.docx',
  ],
  ['text/csv', '.csv'],
  ['text/html', '.html'],
  ['text/plain', '.txt'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/svg+xml', '.svg'],
  ['image/webp', '.webp'],
  ['video/mp4', '.mp4'],
  ['audio/mpeg', '.mp3'],
]);

/** Leading bytes that identify a format regardless of what the page claimed. */
const MAGIC_NUMBERS = [
  { extension: '.pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { extension: '.png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { extension: '.gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { extension: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { extension: '.zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { extension: '.gz', bytes: [0x1f, 0x8b] },
];

/** Name used when a page suggests nothing usable at all. */
const FALLBACK_NAME = 'download';

/** Windows device names that cannot be used as files even on other systems. */
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/** A name that is only dots carries no information and is not a name. */
const ONLY_DOTS = /^\.+$/;

/** One whitespace character, tested one position at a time. */
const WHITESPACE = /\s/;

/**
 * Trim the padding off a suggested name: leading whitespace, and trailing
 * whitespace or dots.
 *
 * `/^\s+|[\s.]+$/` says the same thing in one line, but it backtracks
 * quadratically over a long run of whitespace, and this string was chosen by
 * the page. Walking in from both ends is one pass and cannot be made to cost
 * more. Leading dots survive on purpose: `.bashrc` is a name, not padding.
 *
 * @param {string} value - Name to trim
 * @returns {string} The name without its padding
 */
function trimNameEdges(value) {
  let start = 0;
  let end = value.length;

  while (start < end && WHITESPACE.test(value[start])) {
    start += 1;
  }
  while (
    end > start &&
    (value[end - 1] === '.' || WHITESPACE.test(value[end - 1]))
  ) {
    end -= 1;
  }

  return value.slice(start, end);
}

/**
 * Strip a page-supplied name down to something that can only ever be a file
 * inside the download root.
 *
 * Path separators, drive letters, control characters and `..` segments are
 * removed rather than rejected, because a rejected download is a lost download
 * and the caller asked for the file, not for the page's spelling of it.
 *
 * @param {string} suggested - Name suggested by the page or engine
 * @returns {string} A single safe path segment
 */
export function sanitizeDownloadName(suggested) {
  const raw = typeof suggested === 'string' ? suggested : '';

  // Take the last segment under both separators: a page may suggest
  // `../../etc/passwd` or `C:\Windows\system32\x`, and neither is a location
  // we are willing to honor.
  const lastSegment = raw.split(/[/\\]/).pop() ?? '';

  const cleaned = trimNameEdges(
    lastSegment
      // eslint-disable-next-line no-control-regex -- control characters in a filename are exactly what we are removing
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[:*?"<>|]/g, '_')
  );

  if (!cleaned || ONLY_DOTS.test(cleaned)) {
    return FALLBACK_NAME;
  }

  const stem = cleaned.slice(0, cleaned.lastIndexOf('.') + 1 || undefined);
  if (RESERVED_NAMES.has(stem.replace(/\.$/, '').toLowerCase())) {
    return `_${cleaned}`;
  }

  return cleaned;
}

/**
 * Guess an extension from the first bytes of the file.
 *
 * @param {Buffer|Uint8Array|undefined} head - Leading bytes of the download
 * @returns {string} Extension including the dot, or an empty string
 */
export function extensionFromContent(head) {
  if (!head || head.length === 0) {
    return '';
  }

  const found = MAGIC_NUMBERS.find(({ bytes }) =>
    bytes.every((byte, index) => head[index] === byte)
  );
  return found ? found.extension : '';
}

/**
 * Give a name an extension when the page did not supply one.
 *
 * Pages hand out UUID-like names constantly; a file called
 * `7f1c...-9ab2` is unusable to a human and unopenable by the OS, so the
 * declared MIME type (or the bytes themselves) supplies the missing suffix.
 *
 * @param {Object} options - Naming options
 * @param {string} options.name - Sanitized name
 * @param {string} [options.mimeType] - MIME type declared by the server
 * @param {Buffer|Uint8Array} [options.head] - Leading bytes of the file
 * @returns {string} Name with an extension when one could be determined
 */
export function withExtension({ name, mimeType, head }) {
  if (path.extname(name)) {
    return name;
  }

  const declaredType = String(mimeType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const declared = MIME_EXTENSIONS.get(declaredType);
  const sniffed = extensionFromContent(head);
  // `application/octet-stream` is what a server sends when it does not know
  // either, so the bytes outrank it; any other declared type is a real claim.
  const extension =
    declaredType === GENERIC_BINARY_TYPE
      ? sniffed || declared
      : declared || sniffed;
  return extension ? `${name}${extension}` : name;
}

/**
 * Report whether a resolved path stays inside the download root.
 *
 * The check is done on resolved paths rather than on the name, so a symlinked
 * or relative root cannot be used to step outside it.
 *
 * @param {string} root - Absolute download directory
 * @param {string} candidate - Absolute candidate path
 * @returns {boolean} Whether the candidate is inside the root
 */
export function isInsideRoot(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    !relative.split(path.sep).includes('..')
  );
}

/**
 * Resolve a safe absolute path for a download inside the root.
 *
 * @param {string} root - Absolute download directory
 * @param {string} name - Sanitized file name
 * @returns {string} Absolute path inside the root
 * @throws {Error} When the name would escape the root
 */
export function resolveInsideRoot(root, name) {
  const candidate = path.resolve(root, name);
  if (!isInsideRoot(root, candidate)) {
    throw new Error(
      `refusing to write "${name}" outside the download directory ${root}`
    );
  }
  return candidate;
}

/**
 * Produce the candidate names a rename-on-conflict policy tries, in order.
 *
 * `report.pdf`, `report (2).pdf`, `report (3).pdf`, … — the order is fixed, so
 * two runs of the same scenario produce the same names.
 *
 * @param {string} name - Sanitized file name
 * @param {number} attempt - Zero-based attempt number
 * @returns {string} Candidate name for that attempt
 */
export function renamedCandidate(name, attempt) {
  if (attempt === 0) {
    return name;
  }

  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  return `${stem} (${attempt + 1})${extension}`;
}
