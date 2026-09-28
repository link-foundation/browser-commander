/**
 * E2E: `measureParity()` against every installed Chrome-family browser.
 *
 * The default real launch must be `ok` - no difference from the same binary
 * started by hand, neither in the command line chrome://version reports nor in
 * anything the environment probe reads - headful and headless, through either
 * engine. The engine launch is `ok` only because every one of its extra
 * switches is tied to the `engine-launch-switches` catalogue entry.
 *
 * Google Chrome is required. Chromium, Edge and Brave are measured when they
 * are installed; a browser that is not installed defines no test rather than
 * a skipped one, so the parity workflow's "no SKIP" gate still holds.
 *
 *     RUN_E2E=true xvfb-run -a --server-args="-screen 0 1920x1080x24" \
 *       npm run test:e2e:parity
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { measureParity } from '../../src/browser/parity.js';
import { resolveSystemBrowserExecutable } from '../../src/browser/system-browser.js';
import {
  PARITY_CHROME as CHROME,
  paritySkipReason,
} from '../helpers/e2e-browser.js';

const TEST_TIMEOUT = 180000;

async function installedBrowsers() {
  const browsers = [{ name: 'chrome', executablePath: CHROME }];
  for (const channel of ['chromium', 'msedge', 'brave']) {
    const executablePath = await resolveSystemBrowserExecutable({
      channel,
    }).catch(() => null);
    if (executablePath) {
      browsers.push({ name: channel, executablePath });
    }
  }
  return browsers;
}

function describeUnlisted(report) {
  return JSON.stringify(
    report.unlisted.map(({ path, expected, actual }) => ({
      path,
      expected,
      actual,
    }))
  );
}

// Every browser is measured headful too, so a display is required.
const skip = paritySkipReason();
const browsers = skip ? [] : await installedBrowsers();

describe('E2E Tests - measureParity', { skip }, () => {
  for (const { name, executablePath } of browsers) {
    for (const headless of [false, true]) {
      const mode = headless ? 'headless' : 'headful';

      for (const engine of ['playwright', 'puppeteer']) {
        it(
          `${name} ${mode}: the real launch through ${engine} matches a hand-started browser`,
          { timeout: TEST_TIMEOUT },
          async () => {
            const report = await measureParity({
              engine,
              executablePath,
              headless,
            });
            assert.equal(report.browser.launch, 'real');
            assert.deepEqual(report.commandLine.extra, []);
            assert.deepEqual(report.commandLine.missing, []);
            assert.equal(report.commandLine.attachment.length, 1);
            assert.equal(report.ok, true, describeUnlisted(report));
            assert.deepEqual(report.differences, []);
          }
        );
      }
    }

    it(
      `${name}: an engine launch is explained by the catalogue`,
      { timeout: TEST_TIMEOUT },
      async () => {
        const report = await measureParity({
          engine: 'playwright',
          executablePath,
          launch: 'engine',
        });
        assert.ok(report.commandLine.extra.length > 0);
        assert.equal(report.ok, true, describeUnlisted(report));
        assert.ok(
          report.differences.every(
            (entry) => entry.limitation === 'engine-launch-switches'
          )
        );
      }
    );
  }

  it(
    'reports an opt-in restriction as requested, not as a leak',
    { timeout: TEST_TIMEOUT },
    async () => {
      const report = await measureParity({
        executablePath: CHROME,
        restrictions: ['no-sync'],
      });
      assert.deepEqual(report.commandLine.extra, ['--disable-sync']);
      assert.equal(report.ok, true, describeUnlisted(report));
      assert.deepEqual(
        report.differences.map(({ path, requested }) => ({ path, requested })),
        [{ path: 'commandLine.extra.--disable-sync', requested: true }]
      );
    }
  );
});
