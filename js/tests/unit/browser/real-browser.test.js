import assert from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  assertDedicatedUserDataDir,
  buildRealBrowserArgs,
  launchAndConnectRealBrowser,
  launchAndConnectRealBrowserWithDependencies,
  launchRealBrowser,
} from '../../../src/browser/real-browser.js';
import {
  launchAndConnectRealBrowser as publicHelper,
  launchRealBrowser as publicShortHelper,
} from '../../../src/index.js';

describe('launchAndConnectRealBrowser', () => {
  let temporaryDirectory;

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it('is exported from the package API', () => {
    assert.equal(publicHelper, launchAndConnectRealBrowser);
    assert.equal(launchRealBrowser, launchAndConnectRealBrowser);
    assert.equal(publicShortHelper, launchRealBrowser);
  });

  it('builds a loopback-only CDP command with a dedicated profile', () => {
    const args = buildRealBrowserArgs({
      userDataDir: '/tmp/browser-commander-dedicated',
      remoteDebuggingPort: 9333,
      headless: true,
      args: ['--lang=en-US'],
    });

    assert.deepEqual(args, [
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9333',
      '--user-data-dir=/tmp/browser-commander-dedicated',
      '--disable-session-crashed-bubble',
      '--hide-crash-restore-bubble',
      '--disable-infobars',
      '--password-store=basic',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-crash-restore',
      '--headless=new',
      '--lang=en-US',
    ]);
  });

  it('supports additive arguments and per-default opt-out', () => {
    const args = buildRealBrowserArgs({
      userDataDir: '/tmp/browser-commander-dedicated',
      args: ['--legacy-arg'],
      extraArgs: ['--lang=en-US'],
      ignoreDefaultArgs: ['--no-first-run'],
    });

    assert.ok(args.includes('--password-store=basic'));
    assert.equal(args.includes('--no-first-run'), false);
    assert.ok(args.includes('--no-default-browser-check'));
    assert.deepEqual(args.slice(-2), ['--legacy-arg', '--lang=en-US']);
  });

  it('rejects custom arguments that could bypass protected CDP settings', () => {
    for (const argument of [
      '--remote-debugging-address=0.0.0.0',
      '--remote-debugging-port=9222',
      '--user-data-dir=/tmp/other',
    ]) {
      assert.throws(
        () =>
          buildRealBrowserArgs({
            userDataDir: '/tmp/browser-commander-dedicated',
            remoteDebuggingPort: 0,
            args: [argument],
          }),
        /managed by launchAndConnectRealBrowser/
      );
    }
  });

  it('rejects Chrome default user-data directories', () => {
    for (const profile of ['google-chrome', 'google-chrome-beta']) {
      assert.throws(
        () =>
          assertDedicatedUserDataDir(
            path.join(os.homedir(), '.config', profile),
            {
              platform: 'linux',
              homeDir: os.homedir(),
              environment: {},
            }
          ),
        /dedicated userDataDir/
      );
    }
  });

  it('spawns, waits, connects, and returns process metadata', async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'browser-commander-real-browser-test-')
    );
    const calls = [];
    const browserProcess = { exitCode: null, kill: () => calls.push(['kill']) };
    const browser = { id: 'browser' };
    const page = { id: 'page' };

    const result = await launchAndConnectRealBrowserWithDependencies(
      {
        engine: 'puppeteer',
        channel: 'chrome',
        userDataDir: temporaryDirectory,
        remoteDebuggingPort: 0,
        seedCookies: [{ name: 'SID', value: 'saved' }],
      },
      {
        resolveExecutable: async () => '/opt/google/chrome',
        spawnBrowser: (executablePath, args) => {
          calls.push(['spawn', executablePath, args]);
          return browserProcess;
        },
        waitForEndpoint: async (options) => {
          calls.push(['wait', options.remoteDebuggingPort]);
          return 'http://127.0.0.1:9444';
        },
        connect: async (options) => {
          calls.push(['connect', options]);
          return { browser, page };
        },
      }
    );

    assert.equal(result.browser, browser);
    assert.equal(result.page, page);
    assert.equal(result.browserProcess, browserProcess);
    assert.equal(result.cdpEndpoint, 'http://127.0.0.1:9444');
    assert.equal(result.executablePath, '/opt/google/chrome');
    assert.equal(result.userDataDir, temporaryDirectory);
    assert.deepEqual(calls[1], ['wait', 0]);
    assert.deepEqual(calls[2], [
      'connect',
      {
        engine: 'puppeteer',
        cdpEndpoint: 'http://127.0.0.1:9444',
        seedCookies: [{ name: 'SID', value: 'saved' }],
        verbose: false,
      },
    ]);
  });

  it('terminates the spawned browser when connection fails', async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'browser-commander-real-browser-test-')
    );
    let killed = false;
    const browserProcess = {
      exitCode: null,
      kill: () => {
        killed = true;
      },
    };

    await assert.rejects(
      () =>
        launchAndConnectRealBrowserWithDependencies(
          { userDataDir: temporaryDirectory },
          {
            resolveExecutable: async () => '/opt/google/chrome',
            spawnBrowser: () => browserProcess,
            waitForEndpoint: async () => 'http://127.0.0.1:9222',
            connect: async () => {
              throw new Error('connection failed');
            },
          }
        ),
      /connection failed/
    );

    assert.equal(killed, true);
  });
});
