/** Read Safari's unencrypted, mixed-endian Cookies.binarycookies store.
 * Format: https://github.com/libyal/dtformats/blob/main/documentation/Safari%20Cookies.asciidoc
 * No SameSite attribute is stored in this format; use Lax and report that loss.
 */
import { readFile as readFileBytes, stat } from 'node:fs/promises';
import path from 'node:path';
import { findSafariFile, withSafariAccess } from './safari-access.js';
import { TextDecoder } from 'node:util';
import { matchesDomains } from './migration/domains.js';

const APPLE_EPOCH = 978_307_200;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function invalid(detail) {
  throw new Error(`Invalid Safari binarycookies: ${detail}`);
}

function bounded(data, offset, size) {
  if (offset < 0 || size < 0 || offset + size > data.length) {
    invalid('truncated or out-of-range data');
  }
  return data.subarray(offset, offset + size);
}

function uint(data, offset, bigEndian = false) {
  const bytes = bounded(data, offset, 4);
  return bigEndian ? bytes.readUInt32BE() : bytes.readUInt32LE();
}

function string(record, field) {
  const offset = uint(record, field);
  if (offset < 56 || offset >= record.length) {
    invalid('string offset');
  }
  const end = record.indexOf(0, offset);
  if (end < 0) {
    invalid('unterminated string');
  }
  try {
    return utf8.decode(record.subarray(offset, end));
  } catch {
    return invalid('invalid UTF-8');
  }
}

/** Validate all structural offsets before walking records; counts are bounded
 * by the file size, so forged counts cannot cause unbounded allocations.
 */
function* records(data) {
  if (bounded(data, 0, 4).toString('ascii') !== 'cook') {
    invalid('file signature');
  }
  const pages = uint(data, 4, true);
  bounded(data, 8, pages * 4);
  let pageStart = 8 + pages * 4;
  for (let index = 0; index < pages; index += 1) {
    const page = bounded(data, pageStart, uint(data, 8 + index * 4, true));
    pageStart += page.length;
    if (uint(page, 0) !== 0x00010000) {
      invalid('page signature');
    }
    const count = uint(page, 4);
    const headerSize = 8 + count * 4;
    bounded(page, 0, headerSize);
    let previousEnd = headerSize;
    for (let cookie = 0; cookie < count; cookie += 1) {
      const start = uint(page, 8 + cookie * 4);
      if (start < previousEnd) {
        invalid('overlapping record');
      }
      const size = uint(page, start);
      if (size < 56) {
        invalid('short record');
      }
      const record = bounded(page, start, size);
      previousEnd = start + size;
      yield record;
    }
  }
  // Safari may append a checksum and a plist trailer. They are not cookies.
}

/** Decode cookies in automation shape, using the existing substring filter. */
export function parseSafariCookies(data, domainFilter) {
  const cookies = [];
  for (const record of records(data)) {
    const domain = string(record, 16);
    if (
      domainFilter &&
      !domain.toLowerCase().includes(domainFilter.toLowerCase())
    ) {
      continue;
    }
    const expiry = record.readDoubleLE(40) + APPLE_EPOCH;
    if (
      !Number.isFinite(expiry) ||
      Math.abs(expiry) > Number.MAX_SAFE_INTEGER
    ) {
      invalid('expiry');
    }
    const flags = uint(record, 8);
    cookies.push({
      name: string(record, 20),
      value: string(record, 28),
      domain,
      path: string(record, 24) || '/',
      expires: Math.floor(expiry),
      httpOnly: Boolean(flags & 4),
      secure: Boolean(flags & 1),
      sameSite: 'Lax',
    });
  }
  return cookies;
}

/** Counts decode only domain strings. Names and values are never decoded. */
export function countSafariCookies(data, domains) {
  const byDomain = domains?.length
    ? Object.fromEntries(domains.map((domain) => [domain, 0]))
    : null;
  let total = 0;
  for (const record of records(data)) {
    const host = string(record, 16).toLowerCase();
    total += 1;
    for (const domain of Object.keys(byDomain ?? {})) {
      if (matchesDomains(host, [domain])) {
        byDomain[domain] += 1;
      }
    }
  }
  return { total, byDomain };
}

/** A protected path is still a source: preserve it for an actionable read error. */
export function findSafariCookieFile(profileDir, statFile = stat) {
  const named =
    path.basename(path.dirname(profileDir)) === 'Profiles' &&
    path.basename(path.dirname(path.dirname(profileDir))) === 'Safari';
  const root = named
    ? path.dirname(path.dirname(path.dirname(profileDir)))
    : profileDir;
  const modern = named
    ? [
        path.join(
          root,
          'WebKit/WebsiteDataStore',
          path.basename(profileDir).toLowerCase(),
          'Cookies/Cookies.binarycookies'
        ),
      ]
    : [
        path.join(
          root,
          'WebKit/WebsiteData/Default/Cookies/Cookies.binarycookies'
        ),
        path.join(
          root,
          'WebKit/WebsiteDataStore/Default/Cookies/Cookies.binarycookies'
        ),
      ];
  return findSafariFile(
    [
      ...modern,
      path.join(profileDir, 'Cookies', 'Cookies.binarycookies'),
      path.join(profileDir, 'Cookies.binarycookies'),
    ],
    statFile
  );
}

export function readSafariCookieFile(
  filePath,
  { environment = process.env, readFile = readFileBytes } = {}
) {
  return withSafariAccess(filePath, () => readFile(filePath), environment);
}
