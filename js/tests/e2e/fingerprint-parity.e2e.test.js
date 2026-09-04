/**
 * E2E parity tests: a page must not be able to tell that Browser Commander is
 * driving the browser.
 *
 * The reference capture never speaks CDP. Chrome is started as a plain child
 * process pointed at a local page; the page runs the environment probe and
 * POSTs the report back over HTTP. Every automated capture is delivered the
 * same way, so a difference in the diff is a difference in the browser rather
 * than a difference in how the probe was invoked.
 *
 * Parity is asserted twice, because "the same as a real browser" means a
 * different thing in each mode: a headful capture is compared against a
 * hand-started headful Chrome, and a headless capture against a hand-started
 * headless Chrome. The two references genuinely differ -- see the
 * `headless-is-distinguishable` entry in `src/fingerprint/limitations.js` --
 * so neither comparison can stand in for the other.
 *
 * Prerequisites:
 *   RUN_E2E=true, a Chrome binary, and, for the headful half, a display:
 *
 *     RUN_E2E=true xvfb-run -a --server-args="-screen 0 1920x1080x24" \
 *       npm run test:e2e:parity
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  captureReferenceReport,
  diffReports,
  readProbeSource,
  startProbeServer,
} from '../../../experiments/fingerprint-parity/harness.mjs';
import { launchBrowser } from '../../src/index.js';
import { createFingerprintPreset } from '../../src/fingerprint/presets.js';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const TEST_TIMEOUT = 180000;

/** Why the suite cannot run here, or `false` when it can. */
function skipReason({ headless }) {
  if (!process.env.RUN_E2E) {
    return 'set RUN_E2E=true to run the parity tests';
  }
  if (!existsSync(CHROME)) {
    return `no Chrome binary at ${CHROME}; set CHROME_PATH`;
  }
  if (!headless && process.platform === 'linux' && !process.env.DISPLAY) {
    return 'headful parity needs a display; run under xvfb-run';
  }
  return false;
}

function defineParitySuite({ headless }) {
  const mode = headless ? 'headless' : 'headful';

  describe(
    `E2E Tests - Fingerprint Parity (${mode})`,
    { skip: skipReason({ headless }) },
    () => {
      let server;
      let reference;
      const userDataDirs = [];

      const nextUserDataDir = async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'bc-parity-e2e-'));
        userDataDirs.push(directory);
        return directory;
      };

      /** Drive one capture through the shipped launcher. */
      const captureWithLibrary = async (options) => {
        const token = randomUUID();
        const { browser, page } = await launchBrowser({
          headless,
          slowMo: 0,
          executablePath: CHROME,
          userDataDir: await nextUserDataDir(),
          ...options,
        });
        try {
          await page.goto(server.url(token), { waitUntil: 'load' });
          return { report: await server.waitForReport(token), token };
        } finally {
          await browser.close();
        }
      };

      before(async () => {
        server = await startProbeServer(await readProbeSource());
        reference = await captureReferenceReport({
          executablePath: CHROME,
          server,
          token: randomUUID(),
          headless,
        });
        assert.ok(
          reference && !reference.fatal,
          `reference capture failed: ${reference && reference.fatal}`
        );
      });

      after(async () => {
        if (server) {
          await server.close();
        }
        await Promise.all(
          userDataDirs.map((directory) =>
            rm(directory, { recursive: true, force: true, maxRetries: 10 })
          )
        );
      });

      for (const engine of ['playwright', 'puppeteer']) {
        it(
          `${engine} is indistinguishable from a hand-started Chrome`,
          { timeout: TEST_TIMEOUT },
          async () => {
            const { report } = await captureWithLibrary({ engine });
            const differences = diffReports(reference, report);

            assert.deepEqual(
              differences,
              [],
              `${engine} differs from a real ${mode} browser in: ${differences
                .map((entry) => entry.path)
                .join(', ')}`
            );
          }
        );

        it(
          `${engine} leaks navigator.webdriver once parity is turned off`,
          { timeout: TEST_TIMEOUT },
          async () => {
            // Negative control: without this the parity assertion above could
            // pass for the wrong reason, for example because the probe stopped
            // reporting the field.
            const { report } = await captureWithLibrary({
              engine,
              automationParity: false,
            });
            const paths = diffReports(reference, report).map(
              (entry) => entry.path
            );

            assert.ok(
              paths.includes('navigator.webdriver'),
              `expected navigator.webdriver to leak, saw: ${paths.join(', ')}`
            );
          }
        );

        it(
          `${engine} presents the fingerprint profile it was launched with`,
          { timeout: TEST_TIMEOUT },
          async () => {
            const profile = createFingerprintPreset('macos-chrome', {
              overrides: {
                timezoneId: 'Australia/Sydney',
                languages: ['pt-BR', 'pt', 'en'],
                hardwareConcurrency: 6,
              },
            });
            const { report, token } = await captureWithLibrary({
              engine,
              fingerprint: profile,
            });

            assert.equal(report.navigator.userAgent, profile.userAgent);
            assert.equal(report.navigator.platform, profile.platform);
            assert.equal(report.navigator.hardwareConcurrency, 6);
            assert.equal(report.navigator.deviceMemory, profile.deviceMemory);
            assert.deepEqual(report.navigator.languages, ['pt-BR', 'pt', 'en']);
            assert.equal(report.intl.dateTimeTimeZone, 'Australia/Sydney');
            assert.equal(report.screen.width, profile.screen.width);
            assert.equal(report.screen.availHeight, profile.screen.availHeight);
            assert.equal(report.screen.colorDepth, profile.screen.colorDepth);
            // A machine with no GPU stack reports no WebGL context at all, and
            // there is then nothing for the renderer patch to replace.
            if (report.webgl.webgl1) {
              assert.equal(
                report.webgl.webgl1.unmaskedVendor,
                profile.webgl.unmaskedVendor
              );
              assert.equal(report.webgl.webgl1.vendor, profile.webgl.vendor);
            }
            // The overrides Chrome enforces itself reach the network stack
            // too, which a JavaScript property patch never would. Chrome
            // builds the quality ladder from the plain list, exactly as it
            // does for a real browser configured with these languages.
            assert.equal(
              server.headersFor(token)['accept-language'],
              'pt-BR,pt;q=0.9,en;q=0.8'
            );
            assert.equal(
              server.headersFor(token)['user-agent'],
              profile.userAgent
            );
          }
        );
      }
    }
  );
}

defineParitySuite({ headless: false });
defineParitySuite({ headless: true });
