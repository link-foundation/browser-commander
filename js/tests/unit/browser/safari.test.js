// feature-parity: safari.control@native-typed safari.setup@native-typed safari.seed@native-typed safari.unsupported@native-typed
import { it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { findBrowserSource } from '../../../src/browser/browser-sources.js';
import {
  buildDriverServerArgs,
  resolveWebDriverExecutable,
} from '../../../src/browser/webdriver.js';
import {
  WebDriverPage,
  createWebDriverPage,
} from '../../../src/core/webdriver-page.js';
import { createMockDriver } from '../../helpers/webdriver-mocks.js';
import { launchBrowserWithDependencies } from '../../../src/browser/launcher.js';
import { launchAndConnectRealBrowserWithDependencies } from '../../../src/browser/real-browser.js';
import {
  SafariSetupError,
  SafariUnsupportedError,
  safariLaunchError,
  openSafariSettings,
} from '../../../src/browser/safari-support.js';
import { startTrace } from '../../../src/traces/recorder.js';
import {
  buildLaunchOptions,
  sessionFromLaunch,
} from '../../../src/cli/sessions.js';

it('catalogue exposes both Safari WebDriver executables', () => {
  for (const channel of ['safari', 'safari-tp']) {
    const source = findBrowserSource(channel);
    assert.equal(source.controlProtocol, 'webdriver');
    assert.ok(source.executables.darwin[0].endsWith('/safaridriver'));
  }
});

it('Safari channels route real/common launch and CLI to Selenium and seed cookies', async () => {
  for (const launch of [
    launchBrowserWithDependencies,
    launchAndConnectRealBrowserWithDependencies,
  ]) {
    const driver = createMockDriver({
      capabilities: { browserName: 'safari' },
    });
    const page = await createWebDriverPage(driver);
    let calls = 0;
    const launched = await launch(
      {
        channel: 'safari-tp',
        seedCookies: [
          {
            name: 'auth',
            value: 'yes',
            domain: '.example.test',
            secure: true,
            httpOnly: true,
            expires: -1,
          },
        ],
      },
      {
        launchWebDriver: async (options) => {
          calls++;
          assert.equal(options.browser, 'safari-technology-preview');
          return {
            driver,
            page,
            close: () => driver.quit(),
            driverPath: '/Safari TP/safaridriver',
          };
        },
        resolveExecutable: () => assert.fail('Safari must bypass CDP'),
        resolveSystem: () =>
          assert.fail('Safari must bypass Chromium resolution'),
      }
    );
    assert.equal(calls, 1);
    assert.equal(launched.engine, 'selenium');
    assert.equal(launched.browser, driver);
    assert.equal(driver.state.url, 'about:blank');
    assert.ok(
      driver.calls.some(
        ([method, url]) => method === 'get' && url === 'https://example.test'
      )
    );
    assert.ok(
      driver.calls.some(
        ([method, cookie]) => method === 'addCookie' && cookie.httpOnly
      )
    );
    assert.equal(sessionFromLaunch('playwright', launched).engine, 'selenium');
    await launched.close();
  }
  assert.equal(buildLaunchOptions({ browser: 'safari' }).channel, 'safari');
});

it('Safari fails unsupported launch options before starting and page features before writes', async () => {
  for (const options of [
    { headless: true },
    { userDataDir: '/tmp/profile' },
    { args: ['--flag'] },
    { fingerprint: {} },
    { downloads: true },
  ]) {
    await assert.rejects(
      () =>
        launchBrowserWithDependencies(
          { channel: 'safari', ...options },
          { launchWebDriver: () => assert.fail('must reject before starting') }
        ),
      SafariUnsupportedError
    );
  }
  const page = new WebDriverPage(createMockDriver(), { browserName: 'safari' });
  await assert.rejects(
    () => page.pdf(),
    (error) =>
      error instanceof SafariUnsupportedError && error.feature === 'PDF'
  );
  await assert.rejects(
    () => page.setRequestInterception(true),
    SafariUnsupportedError
  );
  await assert.rejects(
    () => startTrace({ page, output: '/must-not-create' }),
    SafariUnsupportedError
  );
});

it('Safari async evaluation uses execute/async and returns rejected promises as errors', async () => {
  const driver = createMockDriver();
  let mode = 'success';
  driver.executeAsyncScript = (source, ...args) =>
    new Promise((resolve) => {
      vm.runInNewContext(`(function(){${source}}).apply(null, args)`, {
        args: [...args, resolve],
        location: { href: 'https://example.test' },
        setTimeout,
        mode,
      });
    });
  const page = new WebDriverPage(driver, { browserName: 'safari' });
  assert.equal(await page.evaluateAsync(async (value) => value + 1, 4), 5);
  mode = 'error';
  await assert.rejects(
    () =>
      page.evaluateAsync(async () => {
        throw new Error('rejected');
      }),
    /rejected/
  );
});

it('setup errors identify both authorization steps and offer an explicit settings opener', async () => {
  for (const message of [
    "You must enable the 'Allow Remote Automation' option",
    'safaridriver requires --enable authorization',
  ]) {
    const error = safariLaunchError(
      new Error(message),
      'safari-technology-preview'
    );
    assert.ok(error instanceof SafariSetupError);
    assert.match(error.message, /Show features for web developers/);
    assert.match(error.message, /admin password/);
    assert.match(error.message, /Safari Technology Preview.app/);
    assert.equal(typeof error.openSettings, 'function');
  }
  const other = new Error('port already in use');
  assert.equal(safariLaunchError(other, 'safari'), other);
  let argv;
  await openSafariSettings({
    channel: 'safari-tp',
    platform: 'darwin',
    run: async (file, args) => {
      assert.equal(file, 'osascript');
      argv = args;
    },
  });
  assert.ok(argv.some((arg) => arg.includes('Safari Technology Preview')));
});

it('Safari uses its bundled driver and the native --port argument', async () => {
  assert.deepEqual(buildDriverServerArgs('safari', 12345), ['--port', '12345']);
  const result = await resolveWebDriverExecutable({
    browser: 'safari',
    platform: 'darwin',
    checkAccess: async () => {},
    runCommand: () => assert.fail('Safari needs no Selenium Manager'),
  });
  assert.equal(result.driverPath, '/usr/bin/safaridriver');
});
