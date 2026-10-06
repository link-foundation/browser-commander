import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';

import {
  CHROMEDRIVER_DEFAULT_SWITCHES,
  buildDriverServerArgs,
  connectWebDriver,
  launchWebDriver,
  resolveWebDriverExecutable,
  seleniumManagerPath,
  waitForDriverReady,
} from '../../../src/browser/webdriver.js';
import { WebDriverPage } from '../../../src/core/webdriver-page.js';
import { createMockDriver } from '../../helpers/webdriver-mocks.js';

const managerOutput = (result, code = 0) => ({
  stdout: JSON.stringify({ logs: [], result: { code, ...result } }),
  stderr: '',
  code,
});

const accessOnly =
  (...allowed) =>
  async (file) => {
    if (!allowed.includes(file)) {
      throw Object.assign(new Error(`ENOENT ${file}`), { code: 'ENOENT' });
    }
  };

/** selenium-webdriver modules that record what the launcher configured. */
function createMockSelenium(driver = createMockDriver()) {
  const record = { options: [], builders: [] };
  class Options {
    constructor(kind) {
      this.kind = kind;
      this.args = [];
      this.excluded = [];
      this.capabilities = {};
      record.options.push(this);
    }
    addArguments(...args) {
      this.args.push(...args);
      return this;
    }
    excludeSwitches(...switches) {
      this.excluded.push(...switches);
      return this;
    }
    setChromeBinaryPath(binary) {
      this.binary = binary;
      return this;
    }
    setBinary(binary) {
      this.binary = binary;
      return this;
    }
    set(name, value) {
      this.capabilities[name] = value;
      return this;
    }
  }
  class Builder {
    constructor() {
      record.builders.push(this);
    }
    usingServer(url) {
      this.serverUrl = url;
      return this;
    }
    forBrowser(name) {
      this.browser = name;
      return this;
    }
    withCapabilities(capabilities) {
      this.capabilities = capabilities;
      return this;
    }
    setChromeOptions(options) {
      this.options = options;
      return this;
    }
    setFirefoxOptions(options) {
      this.options = options;
      return this;
    }
    build() {
      return driver;
    }
  }
  return {
    record,
    driver,
    selenium: {
      webdriver: { Builder, Capabilities: Options },
      chrome: {
        Options: class extends Options {
          constructor() {
            super('chrome');
          }
        },
      },
      firefox: {
        Options: class extends Options {
          constructor() {
            super('firefox');
          }
        },
      },
    },
  };
}

function createMockProcess() {
  let resolveExit;
  const process = {
    exitCode: null,
    killed: false,
    stderr: { on: () => {} },
    exited: new Promise((resolve) => {
      resolveExit = resolve;
    }),
    kill() {
      this.killed = true;
      this.exitCode = 0;
      resolveExit(0);
    },
  };
  return process;
}

function launchDependencies(overrides = {}) {
  const mock = createMockSelenium();
  const started = [];
  const ports = [41001, 41002];
  const fetched = [];
  return {
    mock,
    started,
    fetched,
    dependencies: {
      selenium: mock.selenium,
      environment: { PATH: '/usr/bin' },
      platform: 'linux',
      checkAccess: accessOnly('/opt/drivers/chromedriver'),
      runCommand: async () =>
        managerOutput({
          driver_path: '/cache/chromedriver',
          browser_path: '/opt/google/chrome/chrome',
        }),
      reservePort: async () => ports.shift(),
      startProcess: (file, args, options) => {
        const child = createMockProcess();
        started.push({ file, args, options, child });
        return child;
      },
      fetch: async (url) => {
        fetched.push(url);
        if (fetched.length === 1) {
          throw new Error('ECONNREFUSED');
        }
        return { ok: true, json: async () => ({ value: { ready: true } }) };
      },
      ...overrides,
    },
  };
}

describe('resolveWebDriverExecutable', () => {
  it('uses an explicit driverPath first', async () => {
    const resolved = await resolveWebDriverExecutable({
      driverPath: '/opt/drivers/chromedriver',
      checkAccess: accessOnly('/opt/drivers/chromedriver'),
      runCommand: () => assert.fail('Selenium Manager must not run'),
    });
    assert.deepEqual(resolved, {
      driverPath: '/opt/drivers/chromedriver',
      browserPath: null,
      source: 'driverPath',
    });
    await assert.rejects(
      () =>
        resolveWebDriverExecutable({
          driverPath: '/missing',
          checkAccess: accessOnly(),
        }),
      /not accessible: \/missing/
    );
  });

  it('then looks on PATH', async () => {
    const resolved = await resolveWebDriverExecutable({
      browser: 'firefox',
      environment: { PATH: '/a:/b' },
      platform: 'linux',
      checkAccess: accessOnly('/b/geckodriver'),
      runCommand: () => assert.fail('Selenium Manager must not run'),
    });
    assert.equal(resolved.driverPath, '/b/geckodriver');
    assert.equal(resolved.source, 'PATH');
  });

  it('uses the target platform path rules on PATH', async () => {
    const resolved = await resolveWebDriverExecutable({
      environment: { PATH: 'C:\\a;C:\\b' },
      platform: 'win32',
      checkAccess: accessOnly('C:\\b\\chromedriver.exe'),
      runCommand: () => assert.fail('Selenium Manager must not run'),
    });
    assert.equal(resolved.driverPath, 'C:\\b\\chromedriver.exe');
  });

  it('then asks Selenium Manager for a matching driver', async () => {
    const commands = [];
    const resolved = await resolveWebDriverExecutable({
      executablePath: '/usr/bin/google-chrome',
      environment: { PATH: '' },
      managerPath: '/sm',
      checkAccess: accessOnly(),
      runCommand: async (file, args) => {
        commands.push([file, ...args]);
        return managerOutput({
          driver_path: '/cache/chromedriver',
          browser_path: '/usr/bin/google-chrome',
        });
      },
    });
    assert.deepEqual(commands, [
      [
        '/sm',
        '--browser',
        'chrome',
        '--output',
        'json',
        '--browser-path',
        '/usr/bin/google-chrome',
      ],
    ]);
    assert.deepEqual(resolved, {
      driverPath: '/cache/chromedriver',
      browserPath: '/usr/bin/google-chrome',
      source: 'selenium-manager',
    });
  });

  it('reports a Selenium Manager failure with its message', async () => {
    const withManagerOutput = (output) =>
      resolveWebDriverExecutable({
        environment: {},
        managerPath: '/sm',
        checkAccess: accessOnly(),
        runCommand: async () => output,
      });
    await assert.rejects(
      withManagerOutput(
        managerOutput({ message: 'Unable to discover proper chromedriver' }, 65)
      ),
      /Could not find chromedriver.*Unable to discover proper chromedriver.*Pass driverPath/
    );
    await assert.rejects(
      withManagerOutput({ stdout: 'panic', code: 101 }),
      /did not return JSON/
    );
  });

  it('rejects browsers it has no driver for', async () => {
    await assert.rejects(
      () => resolveWebDriverExecutable({ browser: 'unknown-browser' }),
      /Unsupported WebDriver browser: unknown-browser/
    );
  });
});

describe('WebDriver server helpers', () => {
  it('finds the Selenium Manager binary shipped with selenium-webdriver', () => {
    assert.equal(
      seleniumManagerPath({ environment: { SE_MANAGER_PATH: '/x/sm' } }),
      '/x/sm'
    );
    const linux = seleniumManagerPath({
      platform: 'linux',
      arch: 'x64',
      environment: {},
    });
    assert.match(
      linux,
      /selenium-webdriver[\\/]bin[\\/]linux-x86_64[\\/]selenium-manager$/
    );
    assert.match(
      seleniumManagerPath({ platform: 'win32', environment: {} }),
      /windows[\\/]selenium-manager\.exe$/
    );
  });

  it('builds the server arguments for each driver', () => {
    assert.deepEqual(buildDriverServerArgs('chrome', 9515), ['--port=9515']);
    assert.deepEqual(buildDriverServerArgs('firefox', 4444), [
      '--port',
      '4444',
      '--host',
      '127.0.0.1',
    ]);
  });

  it('fails fast when the driver exits before it is ready', async () => {
    await assert.rejects(
      () =>
        waitForDriverReady('http://127.0.0.1:1', {
          driverProcess: { exitCode: 1 },
          output: () => 'bind() failed\n',
          fetchImplementation: async () => assert.fail('not reached'),
        }),
      /exited with code 1 before it was ready: bind\(\) failed/
    );
  });

  it('times out when /status never reports ready', async () => {
    await assert.rejects(
      () =>
        waitForDriverReady('http://127.0.0.1:1', {
          timeout: 150,
          fetchImplementation: async () => ({
            ok: true,
            json: async () => ({ value: { ready: false } }),
          }),
        }),
      /was not ready within 150ms/
    );
  });

  it('lists every switch chromedriver adds besides the debugging port', () => {
    assert.equal(CHROMEDRIVER_DEFAULT_SWITCHES.length, 19);
    assert.ok(CHROMEDRIVER_DEFAULT_SWITCHES.includes('enable-automation'));
    assert.ok(!CHROMEDRIVER_DEFAULT_SWITCHES.includes('remote-debugging-port'));
  });
});

describe('launchWebDriver', () => {
  it('starts chromedriver on a reserved port and gives Chrome a clean command line', async () => {
    const { mock, started, fetched, dependencies } = launchDependencies();
    const session = await launchWebDriver(
      { headless: true, bidi: true },
      dependencies
    );
    try {
      assert.equal(session.driverPath, '/cache/chromedriver');
      assert.equal(session.driverSource, 'selenium-manager');
      assert.equal(session.serverUrl, 'http://127.0.0.1:41001');
      assert.deepEqual(started[0].args, ['--port=41001']);
      assert.deepEqual(fetched, [
        'http://127.0.0.1:41001/status',
        'http://127.0.0.1:41001/status',
      ]);

      const [builder] = mock.record.builders;
      assert.equal(builder.serverUrl, 'http://127.0.0.1:41001');
      assert.equal(builder.browser, 'chrome');
      const options = builder.options;
      assert.equal(options.binary, '/opt/google/chrome/chrome');
      assert.deepEqual(options.excluded, [...CHROMEDRIVER_DEFAULT_SWITCHES]);
      assert.ok(options.args.includes('--remote-debugging-port=41002'));
      assert.ok(options.args.includes('--headless=new'));
      assert.ok(
        options.args.includes(`--user-data-dir=${session.userDataDir}`)
      );
      assert.ok(!options.args.includes('--enable-automation'));
      assert.deepEqual(options.capabilities, {
        webSocketUrl: true,
        unhandledPromptBehavior: 'ignore',
      });

      assert.ok(session.page instanceof WebDriverPage);
      assert.equal(session.temporaryProfile, true);
      assert.ok(existsSync(session.userDataDir));
    } finally {
      await session.close();
    }
    assert.ok(started[0].child.killed);
    assert.ok(mock.driver.calls.some(([name]) => name === 'quit'));
    assert.ok(!existsSync(session.userDataDir));
    await session.close(); // idempotent
  });

  it('starts geckodriver for Firefox with a -profile argument', async () => {
    const { mock, started, dependencies } = launchDependencies({
      environment: { PATH: '/usr/bin' },
      checkAccess: accessOnly('/usr/bin/geckodriver'),
    });
    const session = await launchWebDriver(
      {
        browser: 'firefox',
        headless: true,
        executablePath: '/opt/firefox/firefox',
      },
      dependencies
    );
    try {
      assert.equal(started[0].file, '/usr/bin/geckodriver');
      assert.deepEqual(started[0].args, [
        '--port',
        '41001',
        '--host',
        '127.0.0.1',
      ]);
      const { options, browser } = mock.record.builders[0];
      assert.equal(browser, 'firefox');
      assert.equal(options.binary, '/opt/firefox/firefox');
      assert.deepEqual(options.args, [
        '-profile',
        session.userDataDir,
        '-headless',
      ]);
      assert.deepEqual(options.capabilities, {});
    } finally {
      await session.close();
    }
  });

  it('refuses Chrome launch restrictions for Firefox', async () => {
    await assert.rejects(
      () =>
        launchWebDriver(
          { browser: 'firefox', restrictions: ['no-extensions'] },
          launchDependencies().dependencies
        ),
      /Launch restrictions are Chrome switches/
    );
  });

  it('stops the driver and removes the profile when the session cannot start', async () => {
    const { started, dependencies } = launchDependencies();
    const failing = createMockSelenium();
    failing.selenium.webdriver.Builder.prototype.build = () => {
      throw new Error('session not created: Chrome failed to start');
    };
    await assert.rejects(
      () =>
        launchWebDriver({}, { ...dependencies, selenium: failing.selenium }),
      /session not created/
    );
    const profile = failing.record.options[0].args
      .find((arg) => arg.startsWith('--user-data-dir='))
      .slice('--user-data-dir='.length);
    assert.ok(started[0].child.killed);
    assert.ok(!existsSync(profile));
  });
});

function safariDependencies() {
  return launchDependencies({
    platform: 'darwin',
    checkAccess: async () => {},
  });
}

describe('Safari driver lifecycle', () => {
  it('uses no disk profile or Chromium/BiDi capabilities and closes idempotently', async () => {
    const { dependencies, started, mock } = safariDependencies();
    const result = await launchWebDriver(
      { browser: 'safari-technology-preview' },
      dependencies
    );
    assert.equal(result.userDataDir, undefined);
    assert.equal(result.temporaryProfile, false);
    assert.equal(
      mock.record.builders[0].capabilities.capabilities.browserName,
      'Safari Technology Preview'
    );
    assert.deepEqual(started[0].args, ['--port', '41001']);
    assert.match(started[0].file, /Safari Technology Preview.app/);
    await Promise.all([result.close(), result.close()]);
    assert.equal(
      mock.driver.calls.filter(([name]) => name === 'quit').length,
      1
    );
    assert.ok(started[0].child.killed);
  });

  it('cleans up the driver if Safari authorization fails', async () => {
    const { dependencies, started, mock } = safariDependencies();
    mock.selenium.webdriver.Builder.prototype.build = () => {
      throw new Error("You must enable the 'Allow Remote Automation' option");
    };
    await assert.rejects(
      () => launchWebDriver({ browser: 'safari' }, dependencies),
      (error) => error.code === 'SAFARI_SETUP_REQUIRED'
    );
    assert.ok(started[0].child.killed);
  });
});

describe('connectWebDriver', () => {
  it('opens a session on a running server with the given capabilities', async () => {
    const mock = createMockSelenium();
    const session = await connectWebDriver(
      {
        serverUrl: 'http://grid:4444',
        capabilities: { webSocketUrl: true },
      },
      { selenium: mock.selenium }
    );
    const [builder] = mock.record.builders;
    assert.equal(builder.serverUrl, 'http://grid:4444');
    assert.deepEqual(builder.capabilities, {
      browserName: 'chrome',
      webSocketUrl: true,
    });
    assert.ok(session.page instanceof WebDriverPage);
    await session.close();
    assert.ok(mock.driver.calls.some(([name]) => name === 'quit'));
  });

  it('requires a server URL', async () => {
    await assert.rejects(() => connectWebDriver({}), /serverUrl is required/);
  });
});
