/**
 * Guard against a duplication gate that reports success without reading code.
 *
 * `.jscpd.json` used to set `"format": "console"`, but jscpd's `format` selects
 * the *file formats* to scan, not the reporter. No file has the extension
 * `console`, so `npm run check:duplication` analysed 0 files, found 0 clones and
 * exited 0 for every commit - a green check that proved nothing. The static
 * assertions below pin the keys that caused it; the end-to-end run proves the
 * shipped config still reaches a real file.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const JS_ROOT = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../..'
);
const CONFIG_PATH = path.join(JS_ROOT, '.jscpd.json');
const JSCPD_PACKAGE = path.join(JS_ROOT, 'node_modules', 'jscpd');

/**
 * Resolve jscpd's CLI entry point, not its `node_modules/.bin` shim.
 *
 * On Windows npm writes three shims - `jscpd`, `jscpd.cmd` and `jscpd.ps1` -
 * and the extensionless one is a Bourne script that `CreateProcess` cannot
 * execute, so `execFileSync(.bin/jscpd)` fails with ENOENT there while working
 * on Linux and macOS. Reading `bin.jscpd` out of the package manifest gives the
 * same file npm links to, on every platform, and survives an upstream rename.
 */
function resolveJscpdCli() {
  const manifest = path.join(JSCPD_PACKAGE, 'package.json');
  if (!existsSync(manifest)) {
    return null;
  }
  const { bin } = JSON.parse(readFileSync(manifest, 'utf-8'));
  const entry = typeof bin === 'string' ? bin : bin?.jscpd;
  if (!entry) {
    return null;
  }
  const cli = path.join(JSCPD_PACKAGE, entry);
  return existsSync(cli) ? cli : null;
}

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));

describe('.jscpd.json', () => {
  it('does not restrict the scan to a format named after a reporter', () => {
    // `format` is a comma-separated list of jscpd language ids ("javascript",
    // "markup", ...). Naming a reporter there silently matches nothing.
    assert.equal(
      config.format,
      undefined,
      '`format` filters which file types are scanned; use `reporters` instead'
    );
  });

  it('selects reporters through the `reporters` array', () => {
    assert.ok(Array.isArray(config.reporters), '`reporters` must be an array');
    assert.ok(
      config.reporters.includes('console'),
      'console output is what makes a failing run readable in CI logs'
    );
  });

  it('asks to ignore comments through `mode`, not an unknown key', () => {
    // jscpd warns "unknown field 'skipComments'" and carries on; `mode: weak`
    // is the supported spelling of the same intent.
    assert.equal(config.skipComments, undefined);
    assert.equal(config.mode, 'weak');
  });
});

describe('the shipped jscpd config scans real files', () => {
  it('reports at least one analysed source for a one-file project', (t) => {
    const jscpdCli = resolveJscpdCli();
    if (!jscpdCli) {
      return t.skip(
        `jscpd is not installed under ${JSCPD_PACKAGE}; run npm ci in js/`
      );
    }

    const fixture = mkdtempSync(path.join(tmpdir(), 'jscpd-config-'));
    try {
      // jscpd reads `.jscpd.json` from the directory it is invoked in, so the
      // fixture gets a copy of the real config rather than a --config path.
      writeFileSync(
        path.join(fixture, '.jscpd.json'),
        readFileSync(CONFIG_PATH)
      );
      writeFileSync(
        path.join(fixture, 'sample.js'),
        [
          'export function sample(value) {',
          '  return value + 1;',
          '}',
          '',
        ].join('\n')
      );

      const output = path.join(fixture, 'report');
      execFileSync(
        process.execPath,
        [
          jscpdCli,
          '.',
          '--reporters',
          'json',
          '--output',
          output,
          '--no-colors',
        ],
        {
          cwd: fixture,
          stdio: 'pipe',
        }
      );

      const report = JSON.parse(
        readFileSync(path.join(output, 'jscpd-report.json'), 'utf-8')
      );
      assert.ok(
        report.statistics.total.sources > 0,
        `jscpd analysed ${report.statistics.total.sources} files; the config excludes everything`
      );
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
