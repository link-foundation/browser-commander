/**
 * Can Python and Rust open what JavaScript wrote? (issue #87)
 *
 * The unit tests in each language write their own fixtures, so all three
 * could agree with themselves and disagree with each other. This records a
 * real run with a real browser and then hands the bundle to the Python and
 * Rust readers, which print what they found. The three printouts have to say
 * the same thing.
 *
 * Run with: node experiments/trace-cross-language-read.mjs [playwright|puppeteer]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeBrowserCommander } from '../js/src/factory.js';
import { readTrace } from '../js/src/traces/reader.js';
import { TRACE_MODE } from '../js/src/traces/schema.js';
import { launchE2EBrowser } from '../js/tests/helpers/e2e-browser.js';
import { startTraceServer } from '../js/tests/helpers/trace-server.js';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const engine = process.argv[2] ?? 'playwright';

const PYTHON_READER = `
import json
import sys

sys.path.insert(0, ${JSON.stringify(path.join(REPOSITORY_ROOT, 'python', 'src'))})

from browser_commander.traces import read_trace

trace = read_trace(sys.argv[1])
print(json.dumps({
    "schemaVersion": trace.manifest["schemaVersion"],
    "mode": trace.manifest["mode"],
    "outcome": trace.manifest["outcome"],
    "engine": trace.manifest["engine"],
    "events": len(trace.events),
    "kinds": sorted({event["kind"] for event in trace.events}),
    "checkpoints": [checkpoint.name for checkpoint in trace.checkpoints],
    "htmlBytes": len(trace.html(1) or ""),
    "typedName": next(
        (control.get("value") for control in trace.state(1)["controls"]
         if control.get("path", "").endswith("#name")),
        None,
    ),
    "mutationBatches": len(trace.mutations(1)),
    "screenshotBytes": len(trace.screenshot(1) or b""),
    "truncated": trace.truncated,
}, indent=2))
`;

/**
 * Run a reader written in another language and let it print its own view.
 *
 * @param {string} what - Name of the language, for the error message
 * @param {string} command - Program to run
 * @param {string[]} args - Arguments for the program
 * @param {Object} [options] - Extra options for `spawn`
 * @returns {Promise<void>} Resolves when the reader has printed its view
 */
const readWith = (what, command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${what} exited ${code}`))
    );
  });

const server = await startTraceServer();
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-trace-cross-'));
const { page, cleanup } = await launchE2EBrowser({ engine });
const commander = makeBrowserCommander({ page });

try {
  await page.goto(`${server.baseUrl}/`);
  const trace = await commander.startTrace({
    output: path.join(artifacts, 'run'),
    mode: TRACE_MODE.CONTINUOUS,
    screenshots: true,
  });

  await page.type('#name', 'alice');
  await trace.checkpoint('the user typed a name');
  await page.click('#add');
  await page.click('#touch');
  await trace.checkpoint('the app updated itself');
  const stopped = await trace.stop();

  const fromJavaScript = await readTrace(stopped.path);
  console.log('JavaScript reader:');
  console.log(
    JSON.stringify(
      {
        schemaVersion: fromJavaScript.manifest.schemaVersion,
        mode: fromJavaScript.manifest.mode,
        outcome: fromJavaScript.manifest.outcome,
        engine: fromJavaScript.manifest.engine,
        events: fromJavaScript.events.length,
        kinds: [...new Set(fromJavaScript.events.map((e) => e.kind))].sort(),
        checkpoints: fromJavaScript.checkpoints.map((c) => c.name),
        htmlBytes: (await fromJavaScript.html(1)).length,
        typedName: (await fromJavaScript.state(1)).controls.find((control) =>
          control.path.endsWith('#name')
        )?.value,
        mutationBatches: (await fromJavaScript.mutations(1)).length,
        screenshotBytes: (
          await fs.readFile(path.join(stopped.path, 'checkpoints/0001.png'))
        ).length,
        truncated: fromJavaScript.truncated,
      },
      null,
      2
    )
  );

  console.log('\nPython reader:');
  await readWith('python3', 'python3', ['-c', PYTHON_READER, stopped.path]);

  console.log('\nRust reader:');
  await readWith(
    'cargo',
    'cargo',
    ['run', '--quiet', '--example', 'read_trace', '--', stopped.path],
    { cwd: path.join(REPOSITORY_ROOT, 'rust') }
  );
} finally {
  await commander.destroy();
  await cleanup();
  await server.close();
  await fs.rm(artifacts, { recursive: true, force: true });
}
