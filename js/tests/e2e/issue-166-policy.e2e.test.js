import { clearDebugEnvironment } from '../helpers/debug-environment.js';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../src/browser/launcher.js';
import { makeBrowserCommander } from '../../src/factory.js';
import { readTrace } from '../../src/traces/reader.js';
import { CHROME_LAUNCH_OPTIONS } from '../helpers/e2e-browser.js';

function navigate(commander, url, timeout = 5000) {
  return commander.goto({
    url,
    timeout,
    waitForStableUrlBefore: false,
    waitForStableUrlAfter: false,
    waitForNetworkIdle: false,
  });
}

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-readonly-'));
  const cwd = process.cwd();
  const restoreEnvironment = clearDebugEnvironment();
  const readonly = path.join(root, 'checkout');
  const evidence = path.join(root, 'evidence');
  await fs.mkdir(readonly);
  await fs.mkdir(evidence);
  await fs.writeFile(path.join(evidence, 'keep.txt'), 'caller evidence');
  await fs.chmod(readonly, 0o555);
  process.chdir(readonly);
  try {
    if (process.platform !== 'win32') {
      await assert.rejects(fs.access(readonly, fs.constants.W_OK));
    }
    await run({ readonly, evidence });
    assert.deepEqual(await fs.readdir(readonly), []);
  } finally {
    process.chdir(cwd);
    restoreEnvironment();
    await fs.chmod(readonly, 0o700);
    await fs.rm(root, { recursive: true, force: true });
  }
}

for (const engine of ['playwright', 'puppeteer']) {
  it(
    `navigates in read-only cwd and cleans managed recording with ${engine}`,
    {
      skip: process.env.RUN_E2E !== 'true',
      timeout: 90000,
    },
    async () => {
      await fixture(async ({ evidence }) => {
        let launched, commander;
        const managedCommander = () =>
          makeBrowserCommander({
            page: launched.page,
            debug: { directory: evidence, retain: false },
          });
        try {
          launched = await launchBrowser({
            engine,
            headless: true,
            ...CHROME_LAUNCH_OPTIONS,
          });
          commander = makeBrowserCommander({ page: launched.page });
          await navigate(
            commander,
            'data:text/html,<h1>No recording requested</h1>'
          );
          assert.equal(launched.tracePath, null);
          assert.equal(commander.tracePath, null);
          await commander.destroy();
          commander = managedCommander();
          await navigate(commander, 'data:text/html,<h1>Owned recording</h1>');
          assert.equal(path.dirname(commander.tracePath), evidence);
          await commander.stopDebug({ discard: false });
          const trace = await readTrace(commander.tracePath);
          assert.equal(trace.manifest.outcome, 'complete');
          assert.ok(trace.events.some((event) => event.source === 'commander'));
          // First stop determines retention; retained output is now caller-owned.
          await fs.rm(commander.tracePath, { recursive: true });
          await commander.destroy();
          commander = managedCommander();
          await commander.ready;
          await assert.rejects(
            navigate(commander, 'http://127.0.0.1:1/'),
            /ERR_UNSAFE_PORT/
          );
        } finally {
          try {
            await commander?.destroy();
          } finally {
            await launched?.close();
          }
        }
        assert.deepEqual(await fs.readdir(evidence), ['keep.txt']);
      });
    }
  );
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  it(
    `application signal handler cleans managed recording on ${signal}`,
    {
      skip: process.env.RUN_E2E !== 'true' || process.platform === 'win32',
      timeout: 90000,
    },
    async () => {
      await fixture(async ({ readonly, evidence }) => {
        const script = fileURLToPath(
          new URL(
            '../../../examples/managed-debug-session.mjs',
            import.meta.url
          )
        );
        const child = spawn(
          process.execPath,
          [script, evidence, '--wait-for-signal'],
          {
            cwd: readonly,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
          }
        );
        const exited = once(child, 'exit');
        let output = '',
          errors = '';
        child.stderr.on('data', (data) => {
          errors += data;
        });
        try {
          await new Promise((resolve, reject) => {
            child.stdout.on('data', (data) => {
              output += data;
              if (output.includes('"ready":true')) {
                resolve();
              }
            });
            child.once('error', reject);
            child.once('exit', (code) =>
              reject(new Error(`Child exited ${code}: ${errors}`))
            );
          });
          const { tracePath } = JSON.parse(
            output.split('\n').find((line) => line.includes('"ready":true'))
          );
          assert.equal(path.dirname(tracePath), evidence);
          child.kill(signal);
          const [code, killed] = await exited;
          assert.equal(code, 0, errors);
          assert.equal(killed, null);
          assert.deepEqual(await fs.readdir(evidence), ['keep.txt']);
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM');
            await exited;
          }
        }
      });
    }
  );
}
