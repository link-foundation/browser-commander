/**
 * E2E acceptance probe for issue #102: a clean default real-browser launch must
 * let a person sign in with a Google account.
 *
 * The tell-tale is what Google says after an address is submitted. A browser
 * Google trusts answers "Couldn't find your Google Account" for an address that
 * does not exist; a browser it flags as automated answers "This browser or app
 * may not be secure" and never reaches the account lookup. The default launch
 * carries no automation switches (issue #101/#103), so `navigator.webdriver` is
 * false and this probe should see the former, not the latter.
 *
 * This talks to the live accounts.google.com, so it is off by default and never
 * runs in CI. It is headful (Google's checks differ under headless), so on Linux
 * it needs a display:
 *
 *   RUN_GOOGLE_PROBE=true xvfb-run -a --server-args="-screen 0 1920x1080x24" \
 *     npm run test:e2e:google-probe
 *
 * On success it writes docs/screenshots/google-signin-probe.png as evidence.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchRealBrowser } from '../../src/index.js';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const TEST_TIMEOUT = 180000;

const SECURE_WARNING = 'This browser or app may not be secure';
const ACCOUNT_NOT_FOUND = "Couldn't find your Google Account";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.resolve(
  HERE,
  '../../../docs/screenshots/google-signin-probe.png'
);

/** Why the probe cannot run here, or `false` when it can. */
function skipReason() {
  if (process.env.RUN_GOOGLE_PROBE !== 'true') {
    return 'set RUN_GOOGLE_PROBE=true to run the live Google sign-in probe';
  }
  if (!existsSync(CHROME)) {
    return `no Chrome binary at ${CHROME}; set CHROME_PATH`;
  }
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    return 'the headful Google probe needs a display; run under xvfb-run';
  }
  return false;
}

describe(
  'E2E Tests - Google sign-in probe (#102)',
  { skip: skipReason() },
  () => {
    it(
      'a clean default launch reaches the account lookup, not the "not secure" wall',
      { timeout: TEST_TIMEOUT },
      async () => {
        // A clearly nonexistent address, so a trusted browser lands on
        // "Couldn't find your Google Account" instead of a password prompt.
        const address = `bc-parity-probe-${Date.now()}@gmail.com`;
        const session = await launchRealBrowser({
          headless: false,
          executablePath: CHROME,
          args:
            process.env.CHROME_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
        });
        try {
          const { page } = session;
          await page.goto('https://accounts.google.com/signin/v2/identifier', {
            waitUntil: 'load',
            timeout: 60000,
          });
          await page.locator('input[type="email"]').fill(address);
          await page.keyboard.press('Enter');

          // Wait for either outcome so the assertion is not racing the network.
          await page
            .waitForFunction(
              (needles) =>
                needles.some((needle) =>
                  document.body.innerText.includes(needle)
                ),
              [ACCOUNT_NOT_FOUND, SECURE_WARNING],
              { timeout: 60000 }
            )
            .catch(() => {});

          await mkdir(path.dirname(SCREENSHOT), { recursive: true });
          await page.screenshot({ path: SCREENSHOT, fullPage: true });

          const bodyText = await page.evaluate(() => document.body.innerText);
          assert.ok(
            !bodyText.includes(SECURE_WARNING),
            `Google flagged the clean launch as not secure. Screenshot: ${SCREENSHOT}`
          );
          assert.ok(
            bodyText.includes(ACCOUNT_NOT_FOUND),
            `expected "${ACCOUNT_NOT_FOUND}"; got a different page. Screenshot: ${SCREENSHOT}`
          );
        } finally {
          await session.close();
        }
      }
    );
  }
);
