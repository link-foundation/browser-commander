// feature-parity: sessions.handoff@native-typed
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import os from 'node:os';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';

import {
  BROWSER_HANDOFF_VERSION,
  BrowserHandoffError,
  closeHandedOffBrowser,
  installHandoff,
  reconnectBrowserWithDependencies,
  waitForPidExit,
} from '../../../src/browser/browser-handoff.js';
import { launchAndConnectRealBrowserWithDependencies } from '../../../src/browser/real-browser.js';
import { startProcess } from '../../../src/utilities/subprocess.js';
import * as api from '../../../src/index.js';
import { startFakeCdpEndpoint } from '../../helpers/fake-cdp-endpoint.js';

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function fakeEndpoint(options) {
  const endpoint = await startFakeCdpEndpoint(options);
  cleanups.push(() => endpoint.close());
  return endpoint;
}

function handoffFor(endpoint, overrides = {}) {
  return {
    version: BROWSER_HANDOFF_VERSION,
    engine: 'selenium',
    cdpEndpoint: endpoint.endpoint,
    webSocketDebuggerUrl: endpoint.webSocketDebuggerUrl,
    targetId: 'TARGET-1',
    pid: null,
    userDataDir: null,
    temporaryProfile: false,
    remoteDebuggingPort: null,
    executablePath: null,
    ...overrides,
  };
}

/** A connectBrowser stand-in returning a Selenium-shaped connection. */
function fakeConnect(calls, { targetId = 'TARGET-1' } = {}) {
  return async (options) => {
    calls.push(['connect', options]);
    return {
      browser: {
        getWindowHandle: async () => `CDwindow-${targetId}`,
      },
      page: { id: 'page' },
      detach: async () => calls.push(['engine-detach']),
    };
  };
}

/** A long-running process in its own process group, like a browser. */
function sleeper(t, script = 'setInterval(()=>{},1000)') {
  const child = startProcess(process.execPath, ['-e', script], {
    interruption: 'caller',
  });
  cleanups.push(async () => {
    child.kill('SIGKILL');
    await child.exited;
  });
  return child;
}

// These tests stop real processes with POSIX signals and exit codes.
const posixSignals = {
  skip: process.platform === 'win32' && 'POSIX signals and exit codes',
};

describe('browser hand-off (issue #174)', () => {
  it('is exported from the package API', () => {
    assert.equal(typeof api.reconnectBrowser, 'function');
    assert.equal(api.BrowserHandoffError, BrowserHandoffError);
    assert.equal(api.BROWSER_HANDOFF_VERSION, BROWSER_HANDOFF_VERSION);
  });

  it('reattaches to the exact tab and never falls back to another page', async () => {
    const endpoint = await fakeEndpoint();
    const calls = [];
    const session = await reconnectBrowserWithDependencies(
      JSON.stringify(handoffFor(endpoint)),
      { verbose: false },
      { connect: fakeConnect(calls) }
    );
    assert.deepEqual(calls, [
      [
        'connect',
        {
          verbose: false,
          engine: 'selenium',
          cdpEndpoint: endpoint.endpoint,
          targetId: 'TARGET-1',
          fallback: false,
        },
      ],
    ]);
    assert.equal(session.cdpEndpoint, endpoint.endpoint);
    assert.deepEqual(await session.handoff(), handoffFor(endpoint));
  });

  it('reads a hand-off from a JSON file', async () => {
    const endpoint = await fakeEndpoint();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bc-handoff-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'handoff.json');
    await writeFile(file, JSON.stringify(handoffFor(endpoint)));
    const calls = [];
    await reconnectBrowserWithDependencies(
      file,
      {},
      {
        connect: fakeConnect(calls),
      }
    );
    assert.equal(calls[0][1].targetId, 'TARGET-1');
  });

  it('refuses a browser that is gone or replaced instead of launching one', async () => {
    const endpoint = await fakeEndpoint();
    const handoff = handoffFor(endpoint);
    const connect = () => assert.fail('connect reached');
    endpoint.setBrowserId('browser-2');
    await assert.rejects(
      reconnectBrowserWithDependencies(handoff, {}, { connect }),
      (error) =>
        error instanceof BrowserHandoffError &&
        /another browser instance/.test(error.message)
    );
    await endpoint.close();
    await assert.rejects(
      reconnectBrowserWithDependencies(handoff, {}, { connect }),
      /no longer answers/
    );
  });

  it('reports a closed tab as a hand-off error', async () => {
    const endpoint = await fakeEndpoint();
    await assert.rejects(
      reconnectBrowserWithDependencies(
        handoffFor(endpoint),
        {},
        {
          connect: async () => {
            throw new Error('No page with target id TARGET-1');
          },
        }
      ),
      (error) =>
        error instanceof BrowserHandoffError &&
        /Could not reattach to tab TARGET-1/.test(error.message) &&
        error.cause.message === 'No page with target id TARGET-1'
    );
  });

  it('validates the hand-off before touching the network', async () => {
    const connect = () => assert.fail('connect reached');
    await assert.rejects(
      reconnectBrowserWithDependencies(
        { version: 1, cdpEndpoint: 'http://127.0.0.1:1' },
        {},
        { connect }
      ),
      /missing webSocketDebuggerUrl/
    );
    await assert.rejects(
      reconnectBrowserWithDependencies(
        {
          version: 2,
          cdpEndpoint: 'http://127.0.0.1:1',
          webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/x',
          targetId: 'x',
        },
        {},
        { connect }
      ),
      /Unsupported browser hand-off version 2/
    );
  });

  it('detach() hands off once, drops the engine connection, and releases the process', async () => {
    const endpoint = await fakeEndpoint();
    const calls = [];
    const state = {};
    const session = installHandoff(
      {
        browser: { getWindowHandle: async () => 'CDwindow-TAB' },
        page: {},
        detach: async () => calls.push('engine-detach'),
      },
      {
        engine: 'selenium',
        cdpEndpoint: endpoint.endpoint,
        pid: () => 1234,
        connectedBrowser: () => ({ getWindowHandle: async () => 'TAB' }),
        temporaryProfile: true,
        userDataDir: '/tmp/profile',
        release: () => calls.push('release'),
      },
      state
    );
    assert.equal(session.detached, false);
    assert.equal(Object.keys({ ...session }).includes('detached'), false);
    const [first, second] = await Promise.all([
      session.detach(),
      session.detach(),
    ]);
    assert.equal(first, second);
    assert.deepEqual(calls, ['engine-detach', 'release']);
    assert.equal(session.detached, true);
    assert.equal(state.webSocketDebuggerUrl, endpoint.webSocketDebuggerUrl);
    assert.deepEqual(JSON.parse(JSON.stringify(first)), {
      version: BROWSER_HANDOFF_VERSION,
      engine: 'selenium',
      cdpEndpoint: endpoint.endpoint,
      webSocketDebuggerUrl: endpoint.webSocketDebuggerUrl,
      targetId: 'TAB',
      pid: 1234,
      userDataDir: '/tmp/profile',
      temporaryProfile: true,
      remoteDebuggingPort: null,
      executablePath: null,
    });
    assert.equal(await session.handoff(), first);
  });

  it(
    'close() of a reconnected session closes the browser and awaits its process',
    posixSignals,
    async (t) => {
      const child = sleeper(t);
      const endpoint = await fakeEndpoint({
        onBrowserClose: () => child.kill('SIGTERM'),
      });
      const directory = await mkdtemp(path.join(os.tmpdir(), 'bc-handoff-'));
      cleanups.push(() => rm(directory, { recursive: true, force: true }));
      const session = await reconnectBrowserWithDependencies(
        handoffFor(endpoint, {
          pid: child.pid,
          userDataDir: directory,
          temporaryProfile: true,
        }),
        {},
        { connect: fakeConnect([]) }
      );
      await session.close();
      assert.equal(endpoint.closes.length, 1);
      assert.equal(await child.exited, 128 + 15);
      await assert.rejects(access(directory), { code: 'ENOENT' });
      // Idempotent.
      await session.close();
      assert.equal(endpoint.closes.length, 1);
    }
  );

  it(
    'kills the process tree when Browser.close does not stop it',
    posixSignals,
    async (t) => {
      const child = sleeper(t);
      const endpoint = await fakeEndpoint();
      await closeHandedOffBrowser(handoffFor(endpoint, { pid: child.pid }), {
        closeTimeout: 300,
      });
      assert.equal(endpoint.closes.length, 1);
      assert.equal(await child.exited, 128 + 9);
    }
  );

  it(
    'never closes a different browser that took over the endpoint',
    posixSignals,
    async (t) => {
      const child = sleeper(t);
      const endpoint = await fakeEndpoint();
      const handoff = handoffFor(endpoint, { pid: child.pid });
      endpoint.setBrowserId('someone-else');
      await closeHandedOffBrowser(handoff, { closeTimeout: 200 });
      assert.equal(endpoint.closes.length, 0);
      assert.equal(await child.exited, 128 + 9);
    }
  );

  it('waitForPidExit reports whether a process ended in time', async (t) => {
    const child = sleeper(t);
    assert.equal(await waitForPidExit(child.pid, 100), false);
    child.kill('SIGKILL');
    assert.equal(await waitForPidExit(child.pid, 2000), true);
  });
});

describe('launch hand-off (issue #174)', () => {
  function fakeBrowserProcess(calls) {
    const listeners = [];
    const browserProcess = {
      pid: 4321,
      exitCode: null,
      kill: () => {
        calls.push('kill');
        browserProcess.exit(143);
      },
      detach: () => calls.push('process-detach'),
      once: (_event, listener) => {
        if (browserProcess.exitCode === null) {
          listeners.push(listener);
        } else {
          listener(browserProcess.exitCode);
        }
      },
      exit: (code) => {
        browserProcess.exitCode = code;
        for (const listener of listeners.splice(0)) {
          listener(code);
        }
      },
    };
    return browserProcess;
  }

  async function launch({ interruption } = {}) {
    const calls = [];
    const browserProcess = fakeBrowserProcess(calls);
    const endpoint = await fakeEndpoint({
      onBrowserClose: () => browserProcess.exit(0),
    });
    const cdp = {
      send: async () => ({ targetInfo: { targetId: 'LAUNCHED-TAB' } }),
      detach: async () => {},
    };
    const session = await launchAndConnectRealBrowserWithDependencies(
      {
        engine: 'puppeteer',
        channel: 'chrome',
        ...(interruption ? { interruption } : {}),
      },
      {
        resolveExecutable: async () => '/opt/google/chrome',
        reservePort: async () => 9555,
        spawnBrowser: (_path, _args, options) => {
          calls.push(['spawn', options.interruption]);
          return browserProcess;
        },
        waitForEndpoint: async () => endpoint.endpoint,
        connect: async (options) => {
          calls.push(['connect', 'interruption' in options]);
          return {
            browser: {
              close: async () => {
                calls.push('engine-close');
                browserProcess.exit(0);
              },
            },
            page: { target: () => ({ createCDPSession: async () => cdp }) },
            detach: async () => calls.push('engine-detach'),
          };
        },
      }
    );
    return { session, calls, endpoint, browserProcess };
  }

  it('passes interruption ownership to the spawn, not to the engine', async () => {
    const managed = await launch();
    assert.deepEqual(managed.calls.slice(0, 2), [
      ['spawn', 'managed'],
      ['connect', false],
    ]);
    await managed.session.close();
    const caller = await launch({ interruption: 'caller' });
    assert.deepEqual(caller.calls[0], ['spawn', 'caller']);
    await caller.session.close();
    await assert.rejects(launch({ interruption: 'detached' }), TypeError);
  });

  it('detach() leaves the browser running and returns its hand-off', async () => {
    const { session, calls, endpoint, browserProcess } = await launch();
    const handoff = await session.detach();
    assert.equal(handoff.targetId, 'LAUNCHED-TAB');
    assert.equal(handoff.pid, 4321);
    assert.equal(handoff.remoteDebuggingPort, 9555);
    assert.equal(handoff.temporaryProfile, true);
    assert.equal(handoff.webSocketDebuggerUrl, endpoint.webSocketDebuggerUrl);
    assert.deepEqual(calls.slice(2), ['engine-detach', 'process-detach']);
    assert.equal(browserProcess.exitCode, null);
    await access(handoff.userDataDir);

    // The launch still owns the browser: close() closes it over its
    // WebSocket (the engine connection is gone) and awaits the process.
    await session.close();
    assert.equal(endpoint.closes.length, 1);
    assert.equal(browserProcess.exitCode, 0);
    assert.equal(calls.includes('engine-close'), false);
    assert.equal(calls.includes('kill'), false);
    await assert.rejects(access(handoff.userDataDir), { code: 'ENOENT' });
  });
});
