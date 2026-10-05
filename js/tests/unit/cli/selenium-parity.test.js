import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDispatcher } from '../../../src/cli/dispatcher.js';
import { buildLaunchOptions } from '../../../src/cli/sessions.js';
import { launchBrowserWithDependencies } from '../../../src/browser/launcher.js';
import { connectBrowserWithDependencies } from '../../../src/browser/connector.js';

// feature-parity: engines.webdriver@native-typed engines.cli-matrix@native-typed

describe('Selenium uses the common engine entry points', () => {
  it('restores portable cookies and origin state through the common launcher', async () => {
    const visited = [];
    const seeded = [];
    const page = {
      url: () => 'about:blank',
      goto: async (url) => {
        visited.push(url);
      },
      setCookie: async (...cookies) => {
        seeded.push(...cookies);
      },
      evaluateOnNewDocument: async () => {},
      evaluate: async () => {},
      bringToFront: async () => {},
    };
    const cookie = {
      name: 'session',
      value: 'value',
      domain: 'example.com',
      path: '/',
      secure: true,
    };
    const result = await launchBrowserWithDependencies(
      {
        engine: 'selenium',
        launch: 'engine',
        storageState: {
          cookies: [cookie],
          origins: [
            {
              origin: 'https://example.com',
              localStorage: [{ name: 'theme', value: 'dark' }],
            },
          ],
        },
      },
      {
        launchWebDriver: async () => ({
          driver: {},
          page,
          close: async () => {},
        }),
        settleMs: 0,
      }
    );
    assert.deepEqual(seeded, [cookie]);
    assert.deepEqual(visited, ['https://example.com', 'about:blank']);
    await result.close();
  });
  it('preserves WebDriver browser and driver options in the CLI', () => {
    assert.deepEqual(
      buildLaunchOptions({
        engine: 'selenium',
        browser: 'firefox',
        driverPath: '/driver',
        bidi: true,
      }),
      {
        engine: 'selenium',
        headless: false,
        browser: 'firefox',
        driverPath: '/driver',
        bidi: true,
      }
    );
  });

  it('launches through the native driver without loading a CDP engine', async () => {
    const page = { bringToFront: async () => {} };
    const driver = {};
    let options;
    let closed = false;
    const result = await launchBrowserWithDependencies(
      { engine: 'selenium', launch: 'engine', extraArgs: ['--no-sandbox'] },
      {
        launchWebDriver: async (value) => {
          options = value;
          return {
            driver,
            page,
            close: async () => {
              closed = true;
            },
          };
        },
        settleMs: 0,
      }
    );
    assert.equal(result.browser, driver);
    assert.equal(result.page, page);
    assert.deepEqual(options.args, ['--no-sandbox']);
    await result.close();
    assert.equal(closed, true);
  });

  it('connects to a Selenium Grid through the common connector', async () => {
    const driver = {};
    const page = {};
    let options;
    const result = await connectBrowserWithDependencies(
      {
        engine: 'selenium',
        serverUrl: 'http://grid:4444',
        capabilities: { browserName: 'firefox' },
      },
      {
        connectWebDriver: async (value) => {
          options = value;
          return { driver, page, close: async () => {} };
        },
      }
    );
    assert.equal(result.browser, driver);
    assert.equal(options.capabilities.browserName, 'firefox');
  });

  it('exposes the raw Selenium module and driver over generic handles', async () => {
    const driver = { getTitle: async () => 'native driver' };
    const page = {
      waitForSelector: async () => ({
        clear: async () => {},
        sendKeys: async () => {},
      }),
      url: () => 'about:blank',
    };
    const dispatcher = createDispatcher({
      dependencies: {
        loadEngine: async (name) => {
          assert.equal(name, 'selenium');
          return { Builder: class Builder {} };
        },
        launchBrowser: async () => ({
          browser: driver,
          driver,
          page,
          close: async () => {},
        }),
      },
    });
    try {
      const root = await dispatcher.dispatch('handle.root', {
        name: 'selenium',
      });
      assert.ok(root.$handle);
      const builder = await dispatcher.dispatch('handle.get', {
        handle: root,
        property: 'Builder',
      });
      const instance = await dispatcher.dispatch('handle.construct', {
        handle: builder,
      });
      assert.equal(
        (await dispatcher.dispatch('handle.describe', { handle: instance }))
          .type,
        'Builder'
      );
      await dispatcher.dispatch('session.launch', { engine: 'selenium' });
      await dispatcher.dispatch('page.fill', {
        selector: '#name',
        value: 'Ada',
      });
      const handles = await dispatcher.dispatch('handle.root', {
        name: 'session:s1',
      });
      assert.equal(
        await dispatcher.dispatch('handle.call', {
          handle: handles.browser,
          method: 'getTitle',
        }),
        'native driver'
      );
    } finally {
      await dispatcher.close();
    }
  });
});
