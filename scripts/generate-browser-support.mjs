#!/usr/bin/env node
/**
 * Generate the importable-browser support matrix in README.md from the shared
 * catalogue (issue #114).
 *
 * The catalogue `js/src/browser/browser-sources.json` is the single source of
 * truth for the browsers Browser Commander can import from; Python and Rust
 * ship byte-identical copies (checked by
 * `scripts/check-shared-fingerprint-assets.sh`), so one table generated from
 * it describes every language at once. Nobody edits the matrix by hand: adding
 * a browser to the JSON and regenerating is the only way to change it.
 *
 * The table is written between the `browser-support:generated` markers in
 * README.md; everything outside the markers stays hand-written. `--check`
 * regenerates in memory and fails if the file differs, which is what CI runs.
 *
 * Usage:
 *   node scripts/generate-browser-support.mjs          # rewrite README.md
 *   node scripts/generate-browser-support.mjs --check  # fail on any drift
 *   node scripts/generate-browser-support.mjs --root <dir> [--check]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const BEGIN_MARKER = '<!-- browser-support:generated:begin -->';
export const END_MARKER = '<!-- browser-support:generated:end -->';

const CATALOGUE = 'js/src/browser/browser-sources.json';
const DOCUMENT = 'README.md';

const PLATFORMS = [
  { id: 'darwin', title: 'macOS' },
  { id: 'win32', title: 'Windows' },
  { id: 'linux', title: 'Linux' },
];
const FAMILY_TITLES = new Map([
  ['chromium', 'Chromium'],
  ['firefox', 'Firefox'],
  ['safari', 'Safari'],
]);

function parseArguments(argv) {
  const options = { check: false, root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') {
      options.check = true;
    } else if (argument === '--root') {
      index += 1;
      options.root = argv[index];
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

/** Read the catalogue and return its browsers in catalogue order. */
export function readCatalogue(root) {
  const raw = readFileSync(path.join(root, CATALOGUE), 'utf8');
  return JSON.parse(raw).browsers;
}

/**
 * Build the Markdown table (no surrounding markers) from the catalogue. The
 * columns are padded the way Prettier formats Markdown tables, so the document
 * stays Prettier-clean and the generator and the formatter never disagree.
 */
export function renderBrowserSupport(browsers) {
  const headers = ['Browser', 'Family', ...PLATFORMS.map((p) => p.title)];
  const rows = browsers.map((browser) => [
    browser.id,
    FAMILY_TITLES.get(browser.family) ?? browser.family,
    ...PLATFORMS.map((platform) =>
      (browser.roots?.[platform.id] ?? []).length > 0 ? 'Yes' : '—'
    ),
  ]);
  // Prettier pads each column to its widest cell, with at least three dashes
  // in the divider row.
  const widths = headers.map((header, column) =>
    Math.max(header.length, 3, ...rows.map((row) => row[column].length))
  );
  const line = (cells) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  const divider = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;
  return [line(headers), divider, ...rows.map(line)].join('\n');
}

/** Installed control routes, separate from source-root availability above. */
export function renderBrowserControls(browsers) {
  const headers = [
    'Browser',
    ...PLATFORMS.map((platform) => `${platform.title} control`),
    'Source',
    'Protect roots',
  ];
  const routes = {
    chromium: 'CDP',
    firefox: 'WebDriver setup',
    safari: 'safaridriver setup',
  };
  const rows = browsers.map((browser) => [
    browser.id,
    ...PLATFORMS.map((platform) =>
      (browser.roots?.[platform.id] ?? []).length
        ? (routes[browser.family] ?? 'unsupported')
        : '—'
    ),
    browser.family === 'detection' ? 'detection only' : browser.family,
    'Yes',
  ]);
  const widths = headers.map((header, column) =>
    Math.max(header.length, 3, ...rows.map((row) => row[column].length))
  );
  const line = (cells) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  return [
    line(headers),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.map(line),
  ].join('\n');
}

function replaceBetweenMarkers(document, table) {
  const begin = document.indexOf(BEGIN_MARKER);
  const end = document.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `README.md is missing the browser-support markers ${BEGIN_MARKER} / ${END_MARKER}`
    );
  }
  const before = document.slice(0, begin + BEGIN_MARKER.length);
  const after = document.slice(end);
  return `${before}\n\n${table}\n\n${after}`;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const documentPath = path.join(options.root, DOCUMENT);
  // Git may check Markdown out with CRLF on Windows. Compare logical content
  // using the LF endings the renderer emits, avoiding false drift.
  const current = readFileSync(documentPath, 'utf8').replaceAll('\r\n', '\n');
  const browsers = readCatalogue(options.root);
  const table = `${renderBrowserSupport(browsers)}\n\n${renderBrowserControls(browsers)}`;
  const next = replaceBetweenMarkers(current, table);
  if (options.check) {
    if (next !== current) {
      process.stderr.write(
        `${DOCUMENT} is out of date; run: node scripts/generate-browser-support.mjs\n`
      );
      process.exit(1);
    }
    return;
  }
  if (next !== current) {
    writeFileSync(documentPath, next);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
