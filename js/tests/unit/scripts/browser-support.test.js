/**
 * The generated importable-browser support matrix (issue #114).
 *
 * `scripts/generate-browser-support.mjs` turns the shared catalogue
 * `js/src/browser/browser-sources.json` into the table between the
 * `browser-support:generated` markers in README.md. These tests pin the
 * rendering against a fixture catalogue, then pin the repository itself: the
 * committed README must be what the generator writes, so a browser added to
 * the JSON without regenerating fails CI.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { repoPath } from '../../helpers/repo.js';

const { BEGIN_MARKER, END_MARKER, readCatalogue, renderBrowserSupport } =
  await import(pathToFileURL(repoPath('scripts/generate-browser-support.mjs')));

describe('generate-browser-support', () => {
  it('renders a row per browser with per-platform availability', () => {
    const table = renderBrowserSupport([
      {
        id: 'chrome',
        family: 'chromium',
        roots: { darwin: ['a'], win32: ['b'], linux: ['c'] },
      },
      {
        id: 'arc',
        family: 'chromium',
        roots: { darwin: ['a'], win32: ['b'] },
      },
      { id: 'firefox', family: 'firefox', roots: { linux: ['c'] } },
    ]);
    // Columns are padded the way Prettier formats Markdown tables.
    const lines = table.split('\n');
    assert.equal(lines[0], '| Browser | Family   | macOS | Windows | Linux |');
    assert.equal(lines[2], '| chrome  | Chromium | Yes   | Yes     | Yes   |');
    // A browser absent on a platform shows an em dash, not a blank cell.
    assert.equal(lines[3], '| arc     | Chromium | Yes   | Yes     | —     |');
    assert.equal(lines[4], '| firefox | Firefox  | —     | —       | Yes   |');
  });

  it('keeps the committed README in sync with the catalogue', () => {
    const readme = fs.readFileSync(repoPath('README.md'), 'utf8');
    const begin = readme.indexOf(BEGIN_MARKER);
    const end = readme.indexOf(END_MARKER);
    assert.ok(begin !== -1 && end > begin, 'README is missing the markers');
    const between = readme.slice(begin + BEGIN_MARKER.length, end).trim();
    assert.equal(between, renderBrowserSupport(readCatalogue(repoPath('.'))));
  });
});
