/**
 * A persistent profile keeps session cookies across a normal restart
 * (issue #187): log in, `close()`, launch the same `userDataDir` again and the
 * cookie without an expiry date is still sent. `keepSessionCookies: false`
 * loses it, and a temporary profile launches as before.
 *
 *   RUN_E2E=true CHROME_NO_SANDBOX=true \
 *     node scripts/run-tests.mjs tests/e2e/issue-187-session-cookies.e2e.test.js
 *
 * The Firefox case runs when FIREFOX_PATH names a firefox executable (or one
 * is on PATH); geckodriver comes from PATH or Selenium Manager.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { launchBrowser } from '../../src/browser/launcher.js';
import { connectOrLaunch } from '../../src/browser/persistent-session.js';
import { makeBrowserCommander } from '../../src/factory.js';
import {
  CHROME_LAUNCH_OPTIONS,
  PARITY_CHROME,
  SANDBOX_ARGS,
  findFirefox,
  freePort,
} from '../helpers/e2e-browser.js';
import { startSessionCookieHost } from '../helpers/fixture-server.js';

const headless = process.env.HEADLESS !== 'false';
// The installed Chrome, as the other engine suites use: Puppeteer has no
// Chrome for Testing download of its own here.
const CHROME = {
  headless,
  executablePath: PARITY_CHROME,
  ...CHROME_LAUNCH_OPTIONS,
};

// The tabs a launch starts with: one, unless the caller restores the last ones.
async function tabCount(engine, { driver, page }) {
  if (engine === 'selenium') {
    return (await driver.getAllWindowHandles()).length;
  }
  if (engine === 'playwright') {
    return page.context().pages().length;
  }
  return (await page.browser().pages()).length;
}

// The fixture pages never redirect, so the stable-URL polls only add seconds.
function visit(commander, url) {
  return commander.goto({
    url,
    waitForStableUrlBefore: false,
    waitForStableUrlAfter: false,
    waitForNetworkIdle: false,
  });
}

function commanderFor(page) {
  return makeBrowserCommander({
    page,
    enableNetworkTracking: false,
    enableNavigationManager: false,
  });
}

// Two launches and a restart each.
const TEST = { timeout: 120_000 };

// No executable path: the launch picks Playwright's own Chromium, which for a
// headless engine launch of a persistent profile is the full build, not the
// headless shell that cannot keep session cookies.
const CHROME_FOR_TESTING = { headless, args: SANDBOX_ARGS };

const LAUNCHES = [
  {
    name: "launchBrowser (launch: 'engine', Playwright's Chromium)",
    base: CHROME_FOR_TESTING,
    options: { launch: 'engine' },
  },
  {
    name: "launchBrowser (real, Playwright's Chromium)",
    base: CHROME_FOR_TESTING,
    options: {},
  },
  { name: 'launchBrowser (real, Playwright)', options: {} },
  { name: 'launchBrowser (real, Puppeteer)', options: { engine: 'puppeteer' } },
  {
    name: "launchBrowser (launch: 'engine', Playwright)",
    options: { launch: 'engine' },
  },
  {
    name: "launchBrowser (launch: 'engine', Puppeteer)",
    options: { engine: 'puppeteer', launch: 'engine' },
  },
  {
    name: "launchBrowser (launch: 'engine', selenium Chrome)",
    options: { engine: 'selenium', launch: 'engine' },
  },
];

describe(
  'issue #187: session cookies of a persistent profile',
  { skip: !process.env.RUN_E2E, timeout: 600_000 },
  () => {
    let server;
    const profiles = [];

    before(async () => {
      server = await startSessionCookieHost();
    });

    after(async () => {
      await server?.close();
      await Promise.all(
        profiles.map((profile) =>
          // A detached keepOpen browser may still be flushing its profile.
          rm(profile, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 200,
          })
        )
      );
    });

    async function profileDirectory() {
      const profile = await mkdtemp(
        path.join(os.tmpdir(), 'browser-commander-e2e-187-')
      );
      profiles.push(profile);
      return profile;
    }

    // Log in on one launch, restart, and report what the second launch sees.
    async function restart(options, launch = launchBrowser) {
      const first = await launch(options);
      try {
        const commander = commanderFor(first.page);
        await visit(commander, `${server.baseUrl}/login`);
        assert.equal(
          await commander.evaluate({ fn: () => document.cookie }),
          'sid=logged-in'
        );
        // A second tab, which the next launch must not reopen by default.
        await commander.evaluate({
          fn: () => {
            window.open('/other', '_blank');
          },
        });
      } finally {
        await first.close();
      }
      const second = await launch(options);
      try {
        const commander = commanderFor(second.page);
        await visit(commander, `${server.baseUrl}/check`);
        return {
          first,
          second,
          cookie: await commander.evaluate({ fn: () => document.cookie }),
          tabs: await tabCount(commander.engine, second),
        };
      } finally {
        await second.close();
      }
    }

    // A fresh persistent profile keeps the login, and only one tab, on relaunch.
    async function survives(options, launch) {
      const userDataDir = await profileDirectory();
      const result = await restart({ ...options, userDataDir }, launch);
      assert.equal(result.cookie, 'sid=logged-in');
      assert.equal(result.second.keepSessionCookies, true);
      assert.equal(result.tabs, 1, 'the last session tabs are not restored');
      return result;
    }

    for (const { name, base = CHROME, options } of LAUNCHES) {
      const chrome = { ...base, ...options };

      it(
        `${name}: the session cookie survives close() and relaunch`,
        TEST,
        async () => {
          const { second } = await survives(chrome);
          assert.deepEqual(second.warnings, []);
        }
      );

      it(`${name}: keepSessionCookies: false loses it`, TEST, async () => {
        const userDataDir = await profileDirectory();
        const { second, cookie } = await restart({
          ...chrome,
          userDataDir,
          keepSessionCookies: false,
        });
        assert.equal(cookie, '');
        assert.equal(second.keepSessionCookies, false);
      });
    }

    for (const [name, launch] of [
      ['connectOrLaunch', connectOrLaunch],
      ['launchBrowser (keepOpen: true)', launchBrowser],
    ]) {
      it(
        `${name}: the session cookie survives close() and relaunch`,
        TEST,
        async () => {
          await survives(
            {
              ...CHROME,
              remoteDebuggingPort: await freePort(),
              keepOpen: true,
            },
            launch
          );
        }
      );
    }

    it('a temporary profile launches as before', TEST, async () => {
      const { second, cookie } = await restart({ ...CHROME });
      // Each launch has its own empty profile, deleted on close.
      assert.equal(cookie, '');
      assert.equal(second.temporaryProfile, true);
      assert.equal(second.keepSessionCookies, false);
      assert.equal(
        second.args.some(
          (argument) =>
            argument === '--restore-last-session' ||
            argument.includes('SessionRestoreInfobar')
        ),
        false
      );
    });

    it(
      'restoreTabs: true reopens the last session tabs with the cookie',
      TEST,
      async () => {
        const userDataDir = await profileDirectory();
        const { cookie, tabs } = await restart({
          ...CHROME,
          userDataDir,
          restoreTabs: true,
        });
        assert.equal(cookie, 'sid=logged-in');
        assert.ok(tabs > 1, `restored tabs: ${tabs}`);
      }
    );

    const firefox = findFirefox();
    for (const [label, extra, expected] of [
      ['the session cookie survives close() and relaunch', {}, 'sid=logged-in'],
      ['keepSessionCookies: false loses it', { keepSessionCookies: false }, ''],
    ]) {
      it(
        `launchBrowser (launch: 'engine', selenium Firefox): ${label}`,
        {
          ...TEST,
          skip: firefox ? false : 'firefox is not installed (set FIREFOX_PATH)',
        },
        async () => {
          const userDataDir = await profileDirectory();
          const { second, cookie, tabs } = await restart({
            engine: 'selenium',
            launch: 'engine',
            browser: 'firefox',
            executablePath: firefox,
            headless,
            userDataDir,
            ...extra,
          });
          assert.equal(cookie, expected);
          assert.equal(second.keepSessionCookies, expected !== '');
          assert.equal(tabs, 1);
        }
      );
    }
  }
);
