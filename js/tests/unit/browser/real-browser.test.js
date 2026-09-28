import assert from 'node:assert';
import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, it } from 'node:test';

import {
  assertDedicatedUserDataDir,
  buildRealBrowserArgs,
  launchAndConnectRealBrowser,
  launchAndConnectRealBrowserWithDependencies,
  launchRealBrowser,
  waitForCdpEndpoint,
} from '../../../src/browser/real-browser.js';
import { PortRaceError } from '../../../src/browser/debugging-port.js';
import {
  detectAutomationControlledTriggers,
  disablesAutomationControlled,
} from '../../../src/fingerprint/automation-parity.js';
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

  it('builds exactly the command line a person would type', () => {
    // Issue #103: nothing but the dedicated profile and a fixed port.
    assert.deepEqual(
      buildRealBrowserArgs({
        userDataDir: '/tmp/browser-commander-dedicated',
        remoteDebuggingPort: 9333,
      }),
      [
        '--user-data-dir=/tmp/browser-commander-dedicated',
        '--remote-debugging-port=9333',
      ]
    );
  });

  it('never turns AutomationControlled on in a headful launch (#101)', () => {
    const args = buildRealBrowserArgs({
      userDataDir: '/tmp/browser-commander-dedicated',
      remoteDebuggingPort: 9333,
      restrictions: ['legacy-defaults', 'no-extensions', 'no-translate'],
      args: ['--lang=en-US'],
    });
    assert.deepEqual(detectAutomationControlledTriggers(args), []);
    // ...so the switch that shows the unsupported-flag infobar is not needed.
    assert.equal(disablesAutomationControlled(args), false);
  });

  it('refuses port 0, which makes navigator.webdriver true', () => {
    assert.throws(
      () =>
        buildRealBrowserArgs({
          userDataDir: '/tmp/browser-commander-dedicated',
          remoteDebuggingPort: 0,
        }),
      /AutomationControlled/
    );
  });

  it('adds the off switch only for headless, where no infobar can show', () => {
    const headless = buildRealBrowserArgs({
      userDataDir: '/tmp/browser-commander-dedicated',
      remoteDebuggingPort: 9333,
      headless: true,
      args: ['--disable-blink-features=Foo'],
    });
    assert.deepEqual(headless, [
      '--user-data-dir=/tmp/browser-commander-dedicated',
      '--remote-debugging-port=9333',
      '--headless=new',
      '--disable-blink-features=Foo,AutomationControlled',
    ]);
    assert.equal(
      buildRealBrowserArgs({
        userDataDir: '/tmp/browser-commander-dedicated',
        remoteDebuggingPort: 9333,
        headless: true,
        automationParity: false,
      }).includes('--disable-blink-features=AutomationControlled'),
      false
    );
  });

  it('applies opt-in restrictions and merges feature lists', () => {
    const args = buildRealBrowserArgs({
      userDataDir: '/tmp/browser-commander-dedicated',
      remoteDebuggingPort: 9333,
      restrictions: ['no-sync', 'no-translate'],
      args: ['--legacy-arg', '--disable-features=Foo'],
      extraArgs: ['--lang=en-US'],
    });

    assert.deepEqual(args, [
      '--user-data-dir=/tmp/browser-commander-dedicated',
      '--remote-debugging-port=9333',
      '--disable-sync',
      '--disable-features=Translate,Foo',
      '--legacy-arg',
      '--lang=en-US',
    ]);
    assert.throws(
      () =>
        buildRealBrowserArgs({
          userDataDir: '/tmp/x',
          remoteDebuggingPort: 9333,
          restrictions: ['no-such-thing'],
        }),
      /Unknown launch restriction/
    );
  });

  it('rejects custom arguments that could bypass protected CDP settings', () => {
    for (const argument of [
      '--remote-debugging-address=0.0.0.0',
      '--remote-debugging-port=9222',
      '--remote-debugging-pipe',
      '--user-data-dir=/tmp/other',
    ]) {
      assert.throws(
        () =>
          buildRealBrowserArgs({
            userDataDir: '/tmp/browser-commander-dedicated',
            remoteDebuggingPort: 9333,
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
    const browserProcess = fakeProcess(calls);
    const browser = { id: 'browser' };
    const page = { id: 'page' };

    const result = await launchAndConnectRealBrowserWithDependencies(
      {
        engine: 'puppeteer',
        channel: 'chrome',
        userDataDir: temporaryDirectory,
        seedCookies: [{ name: 'SID', value: 'saved' }],
      },
      {
        resolveExecutable: async () => '/opt/google/chrome',
        reservePort: async () => 9444,
        spawnBrowser: (executablePath, args, options) => {
          calls.push(['spawn', executablePath, args, options]);
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
    assert.equal(result.remoteDebuggingPort, 9444);
    assert.equal(result.executablePath, '/opt/google/chrome');
    assert.equal(result.userDataDir, temporaryDirectory);
    assert.equal(result.temporaryProfile, false);
    assert.deepEqual(calls[0], [
      'spawn',
      '/opt/google/chrome',
      [`--user-data-dir=${temporaryDirectory}`, '--remote-debugging-port=9444'],
      { env: undefined, verbose: false },
    ]);
    assert.deepEqual(calls[1], ['wait', 9444]);
    assert.deepEqual(calls[2], [
      'connect',
      {
        engine: 'puppeteer',
        cdpEndpoint: 'http://127.0.0.1:9444',
        seedCookies: [{ name: 'SID', value: 'saved' }],
        verbose: false,
      },
    ]);
    // First-run UI is suppressed with Chrome's own sentinel, not a switch.
    await access(path.join(temporaryDirectory, 'First Run'));
  });

  it('retries with a new reserved port after a port race', async () => {
    const calls = [];
    const ports = [40001, 40002];
    const result = await launchAndConnectRealBrowserWithDependencies(
      { closeTimeout: 50 },
      {
        resolveExecutable: async () => '/opt/google/chrome',
        reservePort: async () => ports.shift(),
        spawnBrowser: () => fakeProcess(calls),
        waitForEndpoint: async ({ remoteDebuggingPort }) => {
          calls.push(['wait', remoteDebuggingPort]);
          if (remoteDebuggingPort === 40001) {
            throw new PortRaceError(40001, 'taken');
          }
          return `http://127.0.0.1:${remoteDebuggingPort}`;
        },
        connect: async () => ({ browser: null, page: null }),
      }
    );
    assert.deepEqual(calls, [['wait', 40001], ['kill'], ['wait', 40002]]);
    assert.equal(result.remoteDebuggingPort, 40002);
    await result.close();
  });

  it('does not retry a port the caller chose', async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        launchAndConnectRealBrowserWithDependencies(
          { remoteDebuggingPort: 9555 },
          {
            resolveExecutable: async () => '/opt/google/chrome',
            spawnBrowser: () => fakeProcess([]),
            waitForEndpoint: async () => {
              attempts++;
              throw new PortRaceError(9555, 'taken');
            },
          }
        ),
      PortRaceError
    );
    assert.equal(attempts, 1);
  });

  it('uses a fresh temporary profile by default and deletes it on close', async () => {
    const calls = [];
    const browserProcess = fakeProcess(calls);
    const result = await launchAndConnectRealBrowserWithDependencies(
      { closeTimeout: 50 },
      {
        resolveExecutable: async () => '/opt/google/chrome',
        reservePort: async () => 40003,
        spawnBrowser: () => browserProcess,
        waitForEndpoint: async () => 'http://127.0.0.1:40003',
        connect: async () => ({ browser: null, page: null }),
      }
    );
    assert.equal(result.temporaryProfile, true);
    assert.match(
      path.basename(result.userDataDir),
      /^browser-commander-profile-/
    );
    await access(path.join(result.userDataDir, 'First Run'));

    await result.close();
    assert.deepEqual(calls, [['kill']]);
    await assert.rejects(() => access(result.userDataDir), /ENOENT/);
  });

  it('closes the browser gracefully through the engine before killing it', async () => {
    const calls = [];
    const browserProcess = fakeProcess(calls);
    const browser = {
      close: async () => {
        calls.push(['browser.close']);
        browserProcess.exit(0);
      },
    };
    const result = await launchAndConnectRealBrowserWithDependencies(
      { engine: 'puppeteer' },
      {
        resolveExecutable: async () => '/opt/google/chrome',
        reservePort: async () => 40004,
        spawnBrowser: () => browserProcess,
        waitForEndpoint: async () => 'http://127.0.0.1:40004',
        connect: async () => ({ browser, page: null }),
      }
    );
    // browser.close() is the session's close(), so it cleans up too.
    await browser.close();
    assert.deepEqual(calls, [['browser.close']]);
    await assert.rejects(() => access(result.userDataDir), /ENOENT/);
  });

  it('passes restriction environment to the browser only', async () => {
    const before = process.env.GOOGLE_API_KEY;
    let spawnOptions;
    const result = await launchAndConnectRealBrowserWithDependencies(
      {
        restrictions: ['no-google-services'],
        env: { EXTRA: '1' },
        closeTimeout: 50,
      },
      {
        resolveExecutable: async () => '/opt/google/chrome',
        reservePort: async () => 40005,
        spawnBrowser: (executablePath, args, options) => {
          spawnOptions = options;
          return fakeProcess([]);
        },
        waitForEndpoint: async () => 'http://127.0.0.1:40005',
        connect: async () => ({ browser: null, page: null }),
      }
    );
    assert.equal(spawnOptions.env.GOOGLE_API_KEY, 'no');
    assert.equal(spawnOptions.env.GOOGLE_DEFAULT_CLIENT_ID, 'no');
    assert.equal(spawnOptions.env.EXTRA, '1');
    assert.equal(process.env.GOOGLE_API_KEY, before);
    await result.close();
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
            reservePort: async () => 9222,
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

describe('waitForCdpEndpoint', () => {
  const listening = (port, id = 'abc') =>
    `DevTools listening on ws://127.0.0.1:${port}/devtools/browser/${id}\n`;

  function stderrWith(text) {
    const stream = new PassThrough();
    stream.write(text);
    return stream;
  }

  it('confirms ownership from the stderr line and the served browser id', async () => {
    const endpoint = await waitForCdpEndpoint({
      remoteDebuggingPort: 9777,
      userDataDir: '/nonexistent',
      browserProcess: { exitCode: null, stderr: stderrWith(listening(9777)) },
      timeout: 2000,
      fetchImplementation: async (url) => {
        assert.equal(url, 'http://127.0.0.1:9777/json/version');
        return {
          ok: true,
          json: async () => ({
            webSocketDebuggerUrl: 'ws://127.0.0.1:9777/devtools/browser/abc',
          }),
        };
      },
    });
    assert.equal(endpoint, 'http://127.0.0.1:9777');
  });

  const waitWith = (stderr, fetchImplementation, timeout = 2000) =>
    waitForCdpEndpoint({
      remoteDebuggingPort: 9777,
      userDataDir: '/nonexistent',
      browserProcess: { exitCode: null, stderr },
      timeout,
      fetchImplementation,
    });

  it('reports a race when another browser answers on the port', async () => {
    await assert.rejects(
      () =>
        waitWith(stderrWith(listening(9777, 'ours')), async () => ({
          ok: true,
          json: async () => ({
            webSocketDebuggerUrl:
              'ws://127.0.0.1:9777/devtools/browser/somebody-else',
          }),
        })),
      PortRaceError
    );
  });

  it('reports a race when Chrome fell back to another address', async () => {
    const stderr = stderrWith(
      'bind() failed: Address already in use (98)\nDevTools listening on ws://[::1]:9777/devtools/browser/x\n'
    );
    await assert.rejects(
      () =>
        waitWith(stderr, async () => {
          throw new Error('must not probe a port we do not own');
        }),
      PortRaceError
    );
  });

  it('never probes the port before the browser claims it', async () => {
    let probes = 0;
    await assert.rejects(
      () =>
        waitWith(
          new PassThrough(),
          async () => {
            probes++;
            return { ok: false };
          },
          300
        ),
      /Timed out/
    );
    assert.equal(probes, 0);
  });
});

function fakeProcess(calls) {
  const listeners = [];
  const process = {
    exitCode: null,
    kill: () => {
      calls.push(['kill']);
      process.exit(143);
    },
    once: (event, listener) => {
      if (process.exitCode === null) {
        listeners.push(listener);
      } else {
        listener(process.exitCode);
      }
    },
    exit: (code) => {
      process.exitCode = code;
      for (const listener of listeners.splice(0)) {
        listener(code);
      }
    },
  };
  return process;
}
