/**
 * Trace conformance across languages (issue #108).
 *
 * Python and Rust record traces natively and must write what JavaScript
 * writes. They compare their output with two committed sets of files, and
 * these tests keep both in step with the JavaScript sources:
 *
 * - `assets.json` in each package holds the in-page capture functions and
 *   the viewer's style and script (`scripts/generate-trace-assets.mjs`);
 * - `tests/fixtures/traces/conformance/expected/` is the bundle, Links
 *   Notation export and redaction corpus the JavaScript recorder produces
 *   for `scenario.json` (`scripts/generate-trace-conformance.mjs`).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { formatTraceLinks, traceLinks } from '../../../src/traces/links.js';
import { repoPath } from '../../helpers/repo.js';

const { generateTraceAssets } = await import(
  pathToFileURL(repoPath('scripts/generate-trace-assets.mjs'))
);
const {
  EXPECTED_DIR,
  generateTraceConformance,
  readScenario,
  recordConformanceScenario,
} = await import(
  pathToFileURL(repoPath('scripts/generate-trace-conformance.mjs'))
);

describe('trace conformance', () => {
  it('keeps the Python and Rust trace assets in sync', async () => {
    assert.deepEqual(
      await generateTraceAssets({ check: true }),
      [],
      'run node scripts/generate-trace-assets.mjs and commit the result'
    );
  });

  it('keeps the golden conformance bundle in sync', async () => {
    assert.deepEqual(
      await generateTraceConformance({ check: true }),
      [],
      'run node scripts/generate-trace-conformance.mjs and commit the result'
    );
  });

  it('streams the same Links Notation the bundle exports afterwards', async () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-conformance-'));
    try {
      await recordConformanceScenario(readScenario(), output);
      assert.equal(
        formatTraceLinks(await traceLinks(path.join(output, 'bundle'))),
        fs.readFileSync(path.join(output, 'trace.lino'), 'utf8')
      );
    } finally {
      fs.rmSync(output, { recursive: true, force: true });
    }
  });

  it('covers every kind of timeline event in the golden bundle', () => {
    const kinds = new Set(
      fs
        .readFileSync(path.join(EXPECTED_DIR, 'bundle/events.ndjson'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).kind)
    );
    for (const kind of [
      'trace.start',
      'checkpoint',
      'navigation',
      'console',
      'pageerror',
      'requestfailed',
      'dialog',
      'download',
      'interaction',
      'dropped',
      'mutations',
      'trace.stop',
    ]) {
      assert.ok(kinds.has(kind), `the scenario never records ${kind}`);
    }
  });
});
