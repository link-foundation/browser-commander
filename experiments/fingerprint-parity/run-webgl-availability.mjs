/**
 * Does an automated browser see the same WebGL as a hand-started one?
 *
 * Playwright 1.62 pushes `--enable-unsafe-swiftshader` on every launch
 * (`_innerDefaultArgs` in packages/playwright-core/src/server/chromium/
 * chromium.ts; until 1.62 the push was guarded by `os.platform() === 'darwin'`).
 * The switch lets Chrome fall back to the SwiftShader software renderer when no
 * usable GPU is present, which a hand-started Chrome refuses to do -- so on a
 * container, a VM or a CI runner the automated browser has WebGL and the real
 * one does not.
 *
 * `collect()` in the probe returns `null` when `canvas.getContext('webgl')`
 * fails, so the whole `webgl.webgl1` subtree appears or disappears rather than
 * a string changing. This script reports, per launch method, whether WebGL came
 * up at all and which renderer answered, and it captures the same run with
 * `automationParity` turned off so the switch's effect is visible from both
 * sides.
 *
 *   RUN_E2E=true xvfb-run -a --server-args="-screen 0 1920x1080x24" \
 *     node experiments/fingerprint-parity/run-webgl-availability.mjs 3
 *
 * Set HEADLESS=true for the headless half, and ARTIFACT=<path> to write the
 * report as JSON.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import { captureReferenceReport, readProbeSource, startProbeServer } from './harness.mjs';
import { launchBrowser } from '../../js/src/index.js';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ROUNDS = Number(process.argv[2] || 3);
const HEADLESS = process.env.HEADLESS === 'true';
const ARTIFACT = process.env.ARTIFACT;

// playwright is a devDependency of the js package, not of the repository root,
// so resolution has to start there.
const playwrightVersion = createRequire(new URL('../../js/package.json', import.meta.url))(
  'playwright/package.json'
).version;

/** `null` when the page could not get a WebGL context, else the renderer. */
const summarize = (report) => {
  const webgl = report && report.webgl && report.webgl.webgl1;
  if (!webgl) {
    return null;
  }
  return { unmaskedVendor: webgl.unmaskedVendor, unmaskedRenderer: webgl.unmaskedRenderer };
};

const METHODS = [
  { name: 'reference', reference: true },
  { name: 'playwright', engine: 'playwright', automationParity: true },
  { name: 'puppeteer', engine: 'puppeteer', automationParity: true },
  { name: 'playwright-parity-off', engine: 'playwright', automationParity: false },
  { name: 'puppeteer-parity-off', engine: 'puppeteer', automationParity: false },
];

const server = await startProbeServer(await readProbeSource());
const observations = Object.fromEntries(METHODS.map((method) => [method.name, []]));
const directories = [];

try {
  for (let round = 0; round < ROUNDS; round += 1) {
    for (const method of METHODS) {
      const token = randomUUID();
      if (method.reference) {
        observations[method.name].push(
          summarize(
            await captureReferenceReport({
              executablePath: CHROME,
              server,
              token,
              headless: HEADLESS,
            })
          )
        );
        continue;
      }
      const userDataDir = await mkdtemp(path.join(tmpdir(), 'bc-webgl-'));
      directories.push(userDataDir);
      const { browser, page } = await launchBrowser({
        engine: method.engine,
        automationParity: method.automationParity,
        headless: HEADLESS,
        slowMo: 0,
        executablePath: CHROME,
        userDataDir,
      });
      try {
        await page.goto(server.url(token), { waitUntil: 'load' });
        observations[method.name].push(summarize(await server.waitForReport(token)));
      } finally {
        await browser.close();
      }
    }
    console.log(`round ${round + 1}/${ROUNDS} done`);
  }
} finally {
  await server.close();
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 10 }))
  );
}

const artifact = {
  headless: HEADLESS,
  rounds: ROUNDS,
  chrome: CHROME,
  playwrightVersion,
  switch: '--enable-unsafe-swiftshader',
  observations,
};

console.log(`\nmode: ${HEADLESS ? 'headless' : 'headful'}, rounds: ${ROUNDS}`);
for (const [method, seen] of Object.entries(observations)) {
  const missing = seen.filter((entry) => entry === null).length;
  console.log(
    `  ${method.padEnd(21)} webgl missing ${missing}/${seen.length}` +
      (missing === seen.length ? '' : `  (${seen.find(Boolean).unmaskedRenderer})`)
  );
}

if (ARTIFACT) {
  await writeFile(ARTIFACT, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`\nwrote ${ARTIFACT}`);
}
