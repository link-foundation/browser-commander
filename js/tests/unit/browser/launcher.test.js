import { after, describe, it } from 'node:test';
import assert from 'node:assert';
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  launchBrowser,
  launchBrowserWithDependencies,
  resolveLaunchExecutable,
} from '../../../src/browser/launcher.js';
import { TEMPORARY_PROFILE_PREFIX } from '../../../src/browser/profile-directory.js';

const exists = (file) =>
  access(file).then(
    () => true,
    () => false
  );

function fakePage(calls = []) {
  return {
    bringToFront: async () => calls.push(['bringToFront']),
    emulateMedia: async (options) => calls.push(['emulateMedia', options]),
    emulateMediaFeatures: async (features) =>
      calls.push(['emulateMediaFeatures', features]),
  };
}

/** A launchRealBrowser stand-in that records what it was asked for. */
function fakeRealLauncher(calls, { engine = 'playwright' } = {}) {
  return async (options) => {
    calls.push(['launchRealBrowser', options]);
    const page = fakePage(calls);
    const context = { pages: () => [page], close: async () => {} };
    const browser =
      engine === 'playwright'
        ? { contexts: () => [context], close: async () => {} }
        : { pages: async () => [page], close: async () => {} };
    const close = async () => calls.push(['close']);
    if (engine === 'puppeteer') {
      browser.close = close;
    }
    return {
      browser,
      page,
      downloads: null,
      close,
      userDataDir: '/tmp/browser-commander-profile-x',
      temporaryProfile: true,
      args: ['--user-data-dir=/tmp/browser-commander-profile-x'],
    };
  };
}

const systemChrome = async () => '/usr/bin/google-chrome';

// An executable laid out like the Chrome for Testing Playwright downloads.
const cftRoot = await mkdtemp(path.join(tmpdir(), 'browser-commander-cft-'));
const cftChrome = path.join(
  cftRoot,
  'chromium-1248',
  'chrome-linux64',
  'chrome'
);
await mkdir(path.dirname(cftChrome), { recursive: true });
await writeFile(cftChrome, '#!/bin/sh\n');
await chmod(cftChrome, 0o755);
after(() => rm(cftRoot, { recursive: true, force: true }));
const cftEngine = async () => ({ executablePath: () => cftChrome });
const noSystemChrome = async () => {
  throw new Error('the installed Google Chrome must not be resolved');
};

describe('launchBrowser', () => {
  it('starts Chrome for Testing by default, never the installed Google Chrome (issue #179)', async () => {
    const calls = [];
    await launchBrowserWithDependencies(
      {},
      {
        launchRealBrowser: fakeRealLauncher(calls),
        resolveSystem: noSystemChrome,
        loadEngineModule: cftEngine,
        settleMs: 0,
      }
    );

    const [, options] = calls.find(([name]) => name === 'launchRealBrowser');
    assert.equal(options.executablePath, cftChrome);
    // No channel is invented: the launch is not Google Chrome's.
    assert.equal('channel' in options, false);
    // The Chrome for Testing defaults are added by launchRealBrowser.
    assert.deepEqual(options.restrictions, []);
    assert.equal('defaultRestrictions' in options, false);
  });

  it('starts the requested Google Chrome with nothing added (issue #103)', async () => {
    const calls = [];
    const googleBefore = process.env.GOOGLE_API_KEY;

    const result = await launchBrowserWithDependencies(
      { channel: 'chrome' },
      {
        launchRealBrowser: fakeRealLauncher(calls),
        resolveSystem: systemChrome,
        settleMs: 0,
      }
    );

    const [, options] = calls.find(([name]) => name === 'launchRealBrowser');
    assert.equal(options.engine, 'playwright');
    assert.equal(options.executablePath, '/usr/bin/google-chrome');
    assert.equal('slowMo' in options, false);
    assert.equal(options.userDataDir, undefined);
    assert.deepEqual(options.restrictions, []);
    assert.deepEqual(options.args, []);
    assert.equal(result.launch, 'real');
    assert.equal(result.temporaryProfile, true);
    // The host process environment is never changed.
    assert.equal(process.env.GOOGLE_API_KEY, googleBefore);

    // Playwright gets the attached default context, like the persistent
    // context it used to get, and closing it closes the browser.
    assert.equal(typeof result.browser.pages, 'function');
    await result.browser.close();
    assert.deepEqual(calls.at(-1), ['close']);
  });

  it('returns the connected Puppeteer browser in real mode', async () => {
    const calls = [];
    const result = await launchBrowserWithDependencies(
      { engine: 'puppeteer', restrictions: ['no-sync'], slowMo: 20 },
      {
        launchRealBrowser: fakeRealLauncher(calls, { engine: 'puppeteer' }),
        loadEngineModule: cftEngine,
        settleMs: 0,
      }
    );

    const [, options] = calls[0];
    assert.deepEqual(options.restrictions, ['no-sync']);
    assert.equal(options.slowMo, 20);
    await result.close();
    assert.deepEqual(calls.at(-1), ['close']);
  });

  it('emulates the colour scheme on the attached page', async () => {
    const calls = [];
    await launchBrowserWithDependencies(
      { colorScheme: 'dark' },
      {
        launchRealBrowser: fakeRealLauncher(calls),
        loadEngineModule: cftEngine,
        settleMs: 0,
      }
    );

    assert.deepEqual(
      calls.find(([name]) => name === 'emulateMedia'),
      ['emulateMedia', { colorScheme: 'dark' }]
    );
  });

  it('closes the browser when post-launch setup fails', async () => {
    const calls = [];
    await assert.rejects(
      () =>
        launchBrowserWithDependencies(
          { fingerprint: { timezone: 'Not/AZone' } },
          {
            launchRealBrowser: fakeRealLauncher(calls),
            loadEngineModule: cftEngine,
            settleMs: 0,
          }
        ),
      /timezone|Not\/AZone/i
    );
    assert.deepEqual(calls.at(-1), ['close']);
  });

  it('rejects an invalid engine, launch mode or restriction before launching', async () => {
    await assert.rejects(
      () => launchBrowser({ engine: 'invalid-engine' }),
      /Invalid engine: invalid-engine/
    );
    await assert.rejects(
      () => launchBrowser({ launch: 'attach' }),
      /Invalid launch mode: attach/
    );
    await assert.rejects(
      () => launchBrowser({ restrictions: ['no-such-restriction'] }),
      /Unknown launch restriction "no-such-restriction"/
    );
    await assert.rejects(
      () => launchBrowser({ defaultRestrictions: ['no-such-default'] }),
      /Unknown launch restriction "no-such-default"/
    );
  });

  describe("launch: 'engine'", () => {
    function fakePlaywright(calls) {
      const page = fakePage(calls);
      return {
        launchPersistentContext: async (userDataDir, options) => {
          calls.push(['launchPersistentContext', userDataDir, options]);
          return {
            pages: () => [page],
            close: async () => calls.push(['context.close']),
          };
        },
      };
    }

    it('uses a fresh temporary profile, deleted on close', async () => {
      const calls = [];
      const result = await launchBrowserWithDependencies(
        { launch: 'engine' },
        { loadEngineModule: async () => fakePlaywright(calls), settleMs: 0 }
      );

      const [, userDataDir, options] = calls[0];
      assert.ok(userDataDir.includes(TEMPORARY_PROFILE_PREFIX));
      assert.equal(await exists(userDataDir), true);
      assert.equal(options.slowMo, 0);
      // Only the automation off switch the engine launch needs; none of the
      // pre-#103 CHROME_ARGS.
      assert.deepEqual(options.args, [
        '--disable-blink-features=AutomationControlled',
      ]);
      assert.equal('env' in options, false);
      assert.equal(result.launch, 'engine');

      await result.browser.close();
      assert.deepEqual(calls.at(-1), ['context.close']);
      assert.equal(await exists(userDataDir), false);
    });

    it('passes restriction environment to the browser process only', async () => {
      const calls = [];
      const googleBefore = process.env.GOOGLE_API_KEY;
      const result = await launchBrowserWithDependencies(
        { launch: 'engine', restrictions: ['legacy-launch-browser'] },
        { loadEngineModule: async () => fakePlaywright(calls), settleMs: 0 }
      );

      const [, , options] = calls[0];
      assert.equal(options.env.GOOGLE_API_KEY, 'no');
      assert.equal(process.env.GOOGLE_API_KEY, googleBefore);
      assert.ok(options.args.includes('--no-first-run'));
      assert.ok(
        options.args.includes(
          '--disable-features=SessionRestoreInfobar,Translate'
        )
      );
      await result.close();
    });

    it('launches Puppeteer without --start-maximized', async () => {
      const calls = [];
      const page = fakePage(calls);
      const puppeteer = {
        launch: async (options) => {
          calls.push(['launch', options]);
          return {
            pages: async () => [page],
            close: async () => calls.push(['browser.close']),
          };
        },
      };
      const result = await launchBrowserWithDependencies(
        { engine: 'puppeteer', launch: 'engine' },
        { loadEngineModule: async () => puppeteer, settleMs: 0 }
      );

      const [, options] = calls[0];
      assert.equal(options.args.includes('--start-maximized'), false);
      await result.close();
      assert.deepEqual(calls.at(-1), ['browser.close']);
    });

    it('adds the Chrome for Testing defaults to its engine launch (issue #179)', async () => {
      const launchWith = async (options, executablePath) => {
        const calls = [];
        const engine = {
          ...fakePlaywright(calls),
          executablePath: () => executablePath,
        };
        const result = await launchBrowserWithDependencies(
          { launch: 'engine', ...options },
          { loadEngineModule: async () => engine, settleMs: 0 }
        );
        await result.close();
        return { args: calls[0][2].args, defaults: result.defaultRestrictions };
      };

      const cft = await launchWith({}, cftChrome);
      assert.deepEqual(cft.defaults, [
        'no-chrome-for-testing-infobar',
        'mock-keychain',
      ]);
      assert.ok(cft.args.includes('--test-type=gpu'));
      assert.ok(cft.args.includes('--use-mock-keychain'));

      for (const [options, executablePath] of [
        [{}, '/home/u/.cache/ms-playwright/chromium-1100/chrome-linux/chrome'],
        [{ channel: 'chrome' }, cftChrome],
        [{ defaultRestrictions: [] }, cftChrome],
      ]) {
        const other = await launchWith(options, executablePath);
        assert.deepEqual(other.defaults, [], JSON.stringify(options));
        assert.equal(other.args.includes('--test-type=gpu'), false);
        assert.equal(other.args.includes('--use-mock-keychain'), false);
      }
    });

    it("points a Selenium launch at the engines' Chrome for Testing (issue #179)", async () => {
      const launches = [];
      const launchWebDriver = async (options) => {
        launches.push(options);
        return { driver: {}, page: fakePage(), close: async () => {} };
      };
      await launchBrowserWithDependencies(
        {
          engine: 'selenium',
          launch: 'engine',
          restrictions: ['no-sync'],
          defaultRestrictions: ['mock-keychain'],
        },
        { launchWebDriver, loadEngineModule: cftEngine, settleMs: 0 }
      );
      assert.equal(launches[0].executablePath, cftChrome);
      // launchWebDriver adds the defaults for the browser it resolves.
      assert.deepEqual(launches[0].restrictions, ['no-sync']);
      assert.deepEqual(launches[0].defaultRestrictions, ['mock-keychain']);

      // An installed browser asked for by channel is left to Selenium.
      await launchBrowserWithDependencies(
        { engine: 'selenium', launch: 'engine', channel: 'chrome' },
        { launchWebDriver, loadEngineModule: cftEngine, settleMs: 0 }
      );
      assert.equal(launches[1].executablePath, undefined);

      // Without Chrome for Testing Selenium picks its own browser, unchanged.
      await launchBrowserWithDependencies(
        { engine: 'selenium', launch: 'engine' },
        {
          launchWebDriver,
          loadEngineModule: async () => ({
            executablePath: () => '/nonexistent',
          }),
          settleMs: 0,
        }
      );
      assert.equal('executablePath' in launches[2], false);
      assert.deepEqual(launches[2].restrictions, []);
    });

    it("leaves Ctrl+C to the caller with interruption: 'caller' (#174)", async () => {
      for (const [interruption, expected] of [
        [undefined, undefined],
        ['managed', undefined],
        ['caller', false],
      ]) {
        const calls = [];
        const result = await launchBrowserWithDependencies(
          { launch: 'engine', interruption },
          { loadEngineModule: async () => fakePlaywright(calls), settleMs: 0 }
        );
        assert.equal(calls[0][2].handleSIGINT, expected);
        await result.close();
      }
      await assert.rejects(
        launchBrowserWithDependencies(
          { launch: 'engine', interruption: 'nobody' },
          { loadEngineModule: async () => fakePlaywright([]), settleMs: 0 }
        ),
        /interruption must be one of managed, caller/
      );
    });
  });
});

describe('resolveLaunchExecutable', () => {
  it('honours an explicit channel or executable path', async () => {
    const requests = [];
    const resolveSystem = async (request) => {
      requests.push(request);
      return '/resolved';
    };
    await resolveLaunchExecutable(
      { engine: 'playwright', channel: 'msedge' },
      { resolveSystem }
    );
    await resolveLaunchExecutable(
      { engine: 'playwright', executablePath: '/opt/chrome' },
      { resolveSystem }
    );
    assert.deepEqual(requests, [
      { channel: 'msedge', executablePath: undefined },
      { channel: 'chrome', executablePath: '/opt/chrome' },
    ]);
  });

  it("starts the engine's Chrome for Testing, never the installed Google Chrome", async () => {
    const executable = await resolveLaunchExecutable(
      { engine: 'playwright' },
      { resolveSystem: noSystemChrome, loadEngineModule: cftEngine }
    );
    assert.equal(executable, cftChrome);
  });

  it('says how to install Chrome for Testing or ask for Google Chrome without it', async () => {
    const missing = async () => ({
      executablePath: () => '/nonexistent/chrome',
    });
    await assert.rejects(
      () =>
        resolveLaunchExecutable(
          { engine: 'playwright' },
          { resolveSystem: noSystemChrome, loadEngineModule: missing }
        ),
      /Chrome for Testing is not installed for playwright: run `npx playwright install chromium`, or pass channel: 'chrome'/
    );
    await assert.rejects(
      () =>
        resolveLaunchExecutable(
          { engine: 'selenium' },
          {
            resolveSystem: noSystemChrome,
            loadEngineModule: async () => {
              throw new Error('not installed');
            },
          }
        ),
      /run `npx playwright install chromium` or `npx puppeteer browsers install chrome`/
    );
  });
});

describe('public launch API', () => {
  it('exports the launch modes, restrictions and profile helpers', async () => {
    const api = await import('../../../src/index.js');
    assert.deepEqual(api.LAUNCH_MODES, ['real', 'engine']);
    assert.ok(api.LAUNCH_RESTRICTIONS.some(({ id }) => id === 'no-sync'));
    assert.ok(api.LAUNCH_RESTRICTION_PRESETS['legacy-defaults']);
    for (const name of [
      'resolveRestrictions',
      'mergeFeatureSwitches',
      'resolveLaunchExecutable',
      'createTemporaryUserDataDir',
      'prepareUserDataDir',
      'removeUserDataDir',
      'reserveLoopbackPort',
      'PortRaceError',
    ]) {
      assert.equal(typeof api[name], 'function', name);
    }
  });
});
