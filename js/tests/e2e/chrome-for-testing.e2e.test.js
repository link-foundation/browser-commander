/**
 * Issue #179: without a channel or executablePath every engine starts Chrome
 * for Testing, hides its "only for automated testing" infobar and keeps it
 * away from the user's keychain.
 */
// feature-parity: launch.chrome-for-testing@native-typed
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isChromeForTesting } from '../../src/browser/launch-executable.js';
import { launchBrowser } from '../../src/browser/launcher.js';
import { readBrowserVersionPage } from '../../src/browser/parity.js';
import { SANDBOX_ARGS } from '../helpers/e2e-browser.js';

function skipReason() {
  if (!process.env.RUN_E2E) {
    return 'set RUN_E2E=true';
  }
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    return 'the infobar is only drawn in a window; run under xvfb-run';
  }
  return false;
}

/** What chrome://version reports about the browser a session started. */
async function versionPage(engine, session) {
  if (engine !== 'selenium') {
    return await readBrowserVersionPage(session.page);
  }
  await session.browser.get('chrome://version');
  return await session.browser.executeScript(`
    const text = (id) => (document.getElementById(id)?.textContent ?? '').trim();
    return { commandLine: text('command_line'), executablePath: text('executable_path') };
  `);
}

/** Height of the browser UI above the page: tab strip, toolbar, infobars. */
async function frameHeight(session) {
  await session.page.goto('data:text/html,<title>frame</title>');
  // The infobar appears just after the first window is shown.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return await session.page.evaluate(
    () => globalThis.outerHeight - globalThis.innerHeight
  );
}

describe(
  'Chrome for Testing by default (issue #179)',
  { skip: skipReason(), timeout: 180000 },
  () => {
    for (const engine of ['playwright', 'puppeteer', 'selenium']) {
      it(`${engine} starts Chrome for Testing without its infobar or keychain`, async () => {
        const session = await launchBrowser({
          engine,
          headless: false,
          args: SANDBOX_ARGS,
        });
        try {
          const { commandLine, executablePath } = await versionPage(
            engine,
            session
          );
          assert.equal(
            isChromeForTesting(executablePath),
            true,
            executablePath
          );
          assert.deepEqual(session.defaultRestrictions, [
            'no-chrome-for-testing-infobar',
            'mock-keychain',
          ]);
          assert.match(commandLine, /--test-type=gpu(\s|$)/u);
          assert.match(commandLine, /--use-mock-keychain(\s|$)/u);
        } finally {
          await session.close();
        }
      });
    }

    it('the default restrictions remove the infobar the opt-out shows', async () => {
      const heights = {};
      for (const [name, defaultRestrictions] of [
        ['defaults', undefined],
        ['opt-out', []],
      ]) {
        const session = await launchBrowser({
          engine: 'playwright',
          headless: false,
          args: SANDBOX_ARGS,
          ...(defaultRestrictions ? { defaultRestrictions } : {}),
        });
        try {
          heights[name] = await frameHeight(session);
        } finally {
          await session.close();
        }
      }
      // The infobar is about 40px tall; nothing else differs between the two.
      assert.ok(
        heights['opt-out'] - heights.defaults >= 20,
        JSON.stringify(heights)
      );
    });
  }
);
