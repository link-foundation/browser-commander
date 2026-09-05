/**
 * Which overrides reach a dedicated worker?
 *
 * A worker gets its own Navigator, so anything the library patches from
 * `Page.addScriptToEvaluateOnNewDocument` is invisible there, and the CDP
 * `Emulation` overrides only partly propagate. This measures three arrangements
 * so the limitation can be stated exactly rather than guessed:
 *
 *   pageOnly    -- overrides on the page session only, as the library ships
 *   workerCdp   -- the same Emulation commands replayed on the worker session
 *   workerCdpJs -- plus a script evaluated in the worker before it starts
 *
 * Driven over a raw CDP websocket because routing a command to a worker session
 * needs a `sessionId`, and neither engine's public CDP surface accepts one:
 * Playwright's `newCDPSession` takes `Page|Frame`, and Puppeteer's worker
 * sessions are internal to its TargetManager.
 *
 * Usage:
 *   node experiments/fingerprint-parity/run-worker-visibility.mjs [output.json]
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { killProcessTree } from './harness.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const engineRequire = createRequire(
  `${process.env.BC_JS_ROOT || path.resolve('js')}/package.json`
);
const WebSocket = engineRequire('ws');

// Values chosen to differ from any plausible host so a match proves the
// override took effect rather than coinciding with the machine.
const OVERRIDES = [
  ['Emulation.setHardwareConcurrencyOverride', { hardwareConcurrency: 12 }],
  [
    'Emulation.setUserAgentOverride',
    {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) WorkerProbe/1.0',
      acceptLanguage: 'fr-FR,fr,en',
      platform: 'MacIntel',
    },
  ],
];

const WORKER_PATCH =
  "Object.defineProperty(Object.getPrototypeOf(navigator), 'platform', " +
  "{ configurable: true, enumerable: true, get: () => 'MacIntel' });";

const READ_NAVIGATOR =
  '{ userAgent: navigator.userAgent, platform: navigator.platform, ' +
  'languages: Array.from(navigator.languages), ' +
  'hardwareConcurrency: navigator.hardwareConcurrency, ' +
  'deviceMemory: navigator.deviceMemory ?? null }';

/** Minimal CDP client with explicit session routing. */
async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl, {
    maxPayload: 256 * 1024 * 1024,
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = [];

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id === undefined) {
      for (const listener of listeners) {
        listener(message);
      }
      return;
    }
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      entry.reject(new Error(message.error.message));
    } else {
      entry.resolve(message.result);
    }
  });

  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = (nextId += 1);
        pending.set(id, { resolve, reject });
        socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          })
        );
      });
    },
    on: (listener) => listeners.push(listener),
    close: () => socket.close(),
  };
}

async function launchChrome() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'bc-worker-'));
  const port = 9700 + Math.floor(Math.random() * 200);
  const child = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      'about:blank',
    ],
    { stdio: 'ignore', detached: true }
  );

  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      return { child, userDataDir, version: await response.json() };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('Chrome did not expose its debugging endpoint');
}

/** Run one arrangement in a freshly launched browser. */
async function measure({ applyToWorkerSession, evaluateInWorker }) {
  const { child, userDataDir, version } = await launchChrome();
  try {
    const client = await connect(version.webSocketDebuggerUrl);
    const { targetInfos } = await client.send('Target.getTargets');
    const pageTarget = targetInfos.find((target) => target.type === 'page');
    const { sessionId: pageSession } = await client.send(
      'Target.attachToTarget',
      {
        targetId: pageTarget.targetId,
        flatten: true,
      }
    );

    await client.send('Page.enable', {}, pageSession);
    for (const [method, params] of OVERRIDES) {
      await client.send(method, params, pageSession);
    }

    const attachments = [];
    if (applyToWorkerSession) {
      client.on(async (message) => {
        if (message.method !== 'Target.attachedToTarget') {
          return;
        }
        const { sessionId, targetInfo, waitingForDebugger } = message.params;
        attachments.push({ type: targetInfo.type, waitingForDebugger });
        for (const [method, params] of OVERRIDES) {
          await client
            .send(method, params, sessionId)
            .catch((error) =>
              attachments.push({ method, error: error.message })
            );
        }
        if (evaluateInWorker) {
          // waitForDebuggerOnStart holds the worker before it runs any of its
          // own code: the only window in which a script can reach worker scope.
          await client
            .send(
              'Runtime.evaluate',
              { expression: WORKER_PATCH, returnByValue: true },
              sessionId
            )
            .catch((error) => attachments.push({ evaluate: error.message }));
        }
        await client
          .send('Runtime.runIfWaitingForDebugger', {}, sessionId)
          .catch(() => {});
      });
      await client.send(
        'Target.setAutoAttach',
        { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
        pageSession
      );
    }

    const evaluate = async (expression) => {
      const result = await client.send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        pageSession
      );
      return result.result?.value;
    };

    const documentSide = await evaluate(`(${READ_NAVIGATOR})`);
    const workerSide = await evaluate(`(async () => {
      const source = "self.onmessage = () => self.postMessage(${READ_NAVIGATOR});";
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const worker = new Worker(url);
      try {
        return await new Promise((resolve, reject) => {
          worker.onmessage = (event) => resolve(event.data);
          worker.onerror = () => reject(new Error('worker failed to start'));
          setTimeout(() => reject(new Error('timed out waiting for the worker')), 10000);
          worker.postMessage('go');
        });
      } finally {
        worker.terminate();
      }
    })()`).catch((error) => ({ error: error.message }));

    client.close();
    return { documentSide, workerSide, attachments };
  } finally {
    await killProcessTree(child);
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10 });
  }
}

const ARRANGEMENTS = [
  ['pageOnly', { applyToWorkerSession: false, evaluateInWorker: false }],
  ['workerCdp', { applyToWorkerSession: true, evaluateInWorker: false }],
  [
    'workerCdpWithScript',
    { applyToWorkerSession: true, evaluateInWorker: true },
  ],
];

async function main() {
  const results = {};
  for (const [name, options] of ARRANGEMENTS) {
    results[name] = await measure(options);
    const { documentSide, workerSide } = results[name];
    const mismatches = Object.keys(documentSide).filter(
      (key) =>
        JSON.stringify(documentSide[key]) !== JSON.stringify(workerSide?.[key])
    );
    results[name].documentWorkerMismatches = mismatches;
    console.log(
      `${name}: worker differs from document on [${mismatches.join(', ')}]`
    );
    console.log(`  worker: ${JSON.stringify(workerSide)}`);
  }

  const outputPath =
    process.argv[2] || path.join(process.cwd(), 'worker-visibility.json');
  await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(`\nwrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
