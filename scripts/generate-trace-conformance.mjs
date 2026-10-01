#!/usr/bin/env node
/**
 * Record the trace conformance scenario and keep its output as the golden
 * bundle every language must reproduce (issue #108).
 *
 * JavaScript, Python and Rust each record traces natively. "The same trace
 * format" is only a promise until something compares the bytes, so
 * `js/tests/fixtures/traces/conformance/scenario.json` describes one run -
 * a page, the events it emits, the calls a caller makes and the clock - and
 * this script records it with the JavaScript recorder against a fake page.
 * The result is committed under `expected/`:
 *
 * - `bundle/` - manifest, events, checkpoints, mutations and `viewer.html`;
 * - `trace.lino` - the Links Notation export written while recording;
 * - `redaction.json` - URLs and what `redactUrl` makes of them.
 *
 * The Python and Rust test suites replay the same scenario with their own
 * recorders and require identical files. Only the manifest's `platform` and
 * `runtime` say which language wrote a bundle, and the tests normalize them.
 *
 * Trace, context and page identifiers count up per process, so the scenario
 * is always recorded in a fresh one: a golden recorded after another trace
 * would say `trace-2`.
 *
 * Usage:
 *   node scripts/generate-trace-conformance.mjs          # rewrite expected/
 *   node scripts/generate-trace-conformance.mjs --check  # fail on any drift
 */
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFORMANCE_DIR = path.join(
  ROOT,
  'js/tests/fixtures/traces/conformance'
);
export const EXPECTED_DIR = path.join(CONFORMANCE_DIR, 'expected');

/** What the golden manifest says about the machine, in every language. */
export const NORMALIZED_PLATFORM = 'conformance';
export const NORMALIZED_RUNTIME = 'conformance';

/** URLs whose redaction every language must agree on. */
export const REDACTION_CORPUS = Object.freeze([
  'https://example.com/path?token=abc&keep=1',
  'https://EXAMPLE.com:443/a/../b/./c?Token=x#frag',
  'http://example.com',
  'https://name:pw@example.com/?q=1',
  'https://user@example.com/x',
  'https://example.com/?a=1&a=2&code=zz&b=hello%20world',
  'https://example.com/?q=a b&secret=s',
  'https://example.com/?q=a+b&secret=s',
  "https://example.com/?q=a%2Bb&session=1&x=~!*()'",
  'https://example.com/cb#access_token=t&state=s',
  'https://example.com/cb#plain-fragment',
  'https://example.com/p a th/ü?x=ü&password=p',
  'https://example.com/?keep=1',
  'https://example.com/?token',
  'https://example.com/?=token&token=',
  'http://example.com:8080/?api_key=1',
  'about:blank',
  'data:text/html,<p>hi</p>',
  '/relative/path?token=abc',
  'not a url',
  '',
]);

function makeClock(clock) {
  return {
    now: () => clock.now,
    monotonic: () => clock.monotonic,
  };
}

/**
 * A page that answers the recorder the way the scenario says.
 *
 * @param {Object} scenario - The parsed scenario
 * @returns {Object} The fake page and the controls a step uses
 */
function createConformancePage(scenario) {
  const emitter = new EventEmitter();
  const state = {
    snapshot: scenario.snapshot,
    mutations: [],
    dropped: 0,
  };
  const context = {};
  const page = {
    context: () => context,
    evaluate: (fn) => Promise.resolve(answer(fn)),
    screenshot: () => Promise.resolve(Buffer.from('fake-png')),
    addInitScript: async () => {},
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
  };
  function answer(fn) {
    const name = typeof fn === 'function' ? fn.name : String(fn);
    if (name === 'captureSnapshotInPage') {
      return JSON.parse(JSON.stringify(state.snapshot));
    }
    if (name === 'drainMutationsInPage') {
      const batches = state.mutations.splice(0);
      const dropped = state.dropped;
      state.dropped = 0;
      return {
        batches: batches.map((batch) => ({
          frameId: 'main',
          mainFrame: true,
          ...batch,
        })),
        dropped,
        installed: true,
        frameId: 'main',
        mainFrame: true,
      };
    }
    return true;
  }
  return { page, state, emitter };
}

/** The JavaScript shape of each engine event a step emits. */
const ENGINE_EVENTS = {
  framenavigated: (data) => ({
    parentFrame: () => (data.main ? null : {}),
    url: () => data.url,
  }),
  console: (data) => ({ type: () => data.type, text: () => data.text }),
  pageerror: (data) => ({ message: data.message, stack: data.stack }),
  requestfailed: (data) => ({
    url: () => data.url,
    method: () => data.method,
    failure: () => ({ errorText: data.errorText }),
  }),
};

/**
 * Record the scenario into `output`.
 *
 * @param {Object} scenario - The parsed scenario
 * @param {string} output - Directory that receives `bundle/` and `trace.lino`
 * @returns {Promise<Object>} What `stop()` returned
 */
export async function recordConformanceScenario(scenario, output) {
  const { startTrace } = await import(
    pathToFileURL(path.join(ROOT, 'js/src/traces/recorder.js')).href
  );
  const { writeTraceViewer } = await import(
    pathToFileURL(path.join(ROOT, 'js/src/traces/viewer.js')).href
  );
  const { page, state, emitter } = createConformancePage(scenario);
  const dialogs = new Set();
  const downloads = new EventEmitter();
  const commander = {
    engine: scenario.engine,
    page,
    log: null,
    dialogManager: {
      onDialog: (listener) => dialogs.add(listener),
      offDialog: (listener) => dialogs.delete(listener),
    },
    downloads: {
      on: (phase, listener) => downloads.on(phase, listener),
      off: (phase, listener) => downloads.off(phase, listener),
    },
  };
  for (const action of ['goto', 'clickButton']) {
    commander[action] = () => {
      const message = state.failNext;
      state.failNext = null;
      return message
        ? Promise.reject(new Error(message))
        : Promise.resolve(true);
    };
  }

  const { links, ...options } = scenario.options;
  const trace = await startTrace({
    ...options,
    commander,
    output: path.join(output, 'bundle'),
    links: links ? { output: path.join(output, 'trace.lino') } : null,
    ...makeClock(scenario.clock),
  });

  let result = null;
  for (const step of scenario.steps) {
    switch (step.op) {
      case 'queueMutations':
        state.mutations.push(...step.batches);
        state.dropped += step.dropped ?? 0;
        break;
      case 'setSnapshot':
        state.snapshot = step.snapshot;
        break;
      case 'emit':
        emitter.emit(step.event, ENGINE_EVENTS[step.event](step.data));
        break;
      case 'dialog':
        for (const listener of dialogs) {
          listener({
            type: () => step.data.type,
            message: () => step.data.message,
          });
        }
        break;
      case 'download':
        downloads.emit(step.phase, step.artifact);
        break;
      case 'interaction':
        state.failNext = step.fail ?? null;
        try {
          await commander[step.action](step.target);
        } catch {
          // The failure is what the trace records.
        }
        break;
      case 'checkpoint':
        await trace.checkpoint(step.name, {
          actor: step.actor,
          reason: step.reason,
        });
        break;
      case 'event':
        await trace.event(step.name, step.data);
        break;
      case 'stop':
        result = await trace.stop();
        break;
      default:
        throw new Error(`unknown conformance step ${step.op}`);
    }
  }
  await writeTraceViewer(path.join(output, 'bundle'));
  return result;
}

/**
 * Every file under a directory, by relative path.
 *
 * @param {string} dir - Directory to read
 * @returns {Map<string, Buffer>} Contents by POSIX relative path
 */
export function readTree(dir) {
  const files = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files.set(
          path.relative(dir, full).split(path.sep).join('/'),
          fs.readFileSync(full)
        );
      }
    }
  };
  walk(dir);
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Rewrite what a manifest says about the machine, wherever it appears.
 *
 * @param {Map<string, Buffer>} files - Recorded files
 * @param {Object} machine - `{platform, runtime}` the recorder wrote
 * @returns {Map<string, Buffer>} The files with neutral values
 */
export function normalizeMachine(files, machine) {
  const normalized = new Map();
  for (const [name, data] of files) {
    if (!/\.(json|html)$/u.test(name)) {
      normalized.set(name, data);
      continue;
    }
    let text = data.toString('utf8');
    for (const [key, value, neutral] of [
      ['platform', machine.platform, NORMALIZED_PLATFORM],
      ['runtime', machine.runtime, NORMALIZED_RUNTIME],
    ]) {
      for (const separator of [': ', ':']) {
        text = text
          .split(`"${key}"${separator}${JSON.stringify(value)}`)
          .join(`"${key}"${separator}${JSON.stringify(neutral)}`);
      }
    }
    normalized.set(name, Buffer.from(text, 'utf8'));
  }
  return normalized;
}

/**
 * The scenario every language replays.
 *
 * @returns {Object} The parsed `scenario.json`
 */
export function readScenario() {
  return JSON.parse(
    fs.readFileSync(path.join(CONFORMANCE_DIR, 'scenario.json'), 'utf8')
  );
}

/**
 * Record the scenario and return the golden files.
 *
 * @returns {Promise<Map<string, Buffer>>} Contents by relative path
 */
export async function renderConformance() {
  const scenario = readScenario();
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-conformance-'));
  try {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), '--record', output],
      { encoding: 'utf8' }
    );
    if (child.status !== 0) {
      throw new Error(`recording the scenario failed: ${child.stderr}`);
    }
    const manifest = JSON.parse(
      fs.readFileSync(path.join(output, 'bundle/manifest.json'), 'utf8')
    );
    const files = normalizeMachine(readTree(output), manifest);

    const { redactUrl, normalizePrivacyOptions } = await import(
      pathToFileURL(path.join(ROOT, 'js/src/traces/redaction.js')).href
    );
    const privacy = normalizePrivacyOptions(scenario.options.privacy);
    const corpus = REDACTION_CORPUS.map((url) => ({
      url,
      redacted: redactUrl(url, privacy),
    }));
    files.set(
      'redaction.json',
      Buffer.from(`${JSON.stringify(corpus, null, 2)}\n`, 'utf8')
    );
    return files;
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
}

/**
 * Compare or rewrite `expected/`.
 *
 * @param {Object} [options] - `{check}`
 * @returns {Promise<string[]>} Files that differ, are missing or are stale
 */
export async function generateTraceConformance({ check = false } = {}) {
  const files = await renderConformance();
  const current = fs.existsSync(EXPECTED_DIR)
    ? readTree(EXPECTED_DIR)
    : new Map();
  const changed = [
    ...[...files]
      .filter(([name, data]) => !current.get(name)?.equals(data))
      .map(([name]) => name),
    ...[...current.keys()].filter((name) => !files.has(name)),
  ];
  if (!check && changed.length > 0) {
    fs.rmSync(EXPECTED_DIR, { recursive: true, force: true });
    for (const [name, data] of files) {
      const target = path.join(EXPECTED_DIR, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
  }
  return changed;
}

if (
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href &&
  process.argv[2] === '--record'
) {
  await recordConformanceScenario(readScenario(), process.argv[3]);
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const check = process.argv.includes('--check');
  const changed = await generateTraceConformance({ check });
  if (check && changed.length > 0) {
    console.error(
      `out of date: ${changed.join(', ')}; run node scripts/generate-trace-conformance.mjs`
    );
    process.exit(1);
  }
  for (const name of check ? [] : changed) {
    console.log(`wrote expected/${name}`);
  }
}
