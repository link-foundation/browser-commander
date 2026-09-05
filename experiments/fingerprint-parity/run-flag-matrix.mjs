/**
 * Which Chrome switches actually flip the automation-visible surfaces?
 *
 * Each row starts a plain Chrome child process (never a CDP client) with one
 * extra switch set and reports the fields that automation is suspected of
 * changing. This isolates "the switch did it" from "the CDP client did it".
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  captureReferenceReport,
  projectReport,
  readProbeSource,
  startProbeServer,
} from './harness.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const HEADLESS = process.env.PARITY_HEADLESS === 'true';

const CASES = [
  ['plain', []],
  ['enable-automation', ['--enable-automation']],
  [
    'enable-automation+disable-blink-AutomationControlled',
    ['--enable-automation', '--disable-blink-features=AutomationControlled'],
  ],
  ['remote-debugging-port', ['--remote-debugging-port=0']],
  ['remote-debugging-pipe', ['--remote-debugging-pipe']],
  ['test-type', ['--test-type']],
  ['no-sandbox', ['--no-sandbox']],
  ['disable-gpu', ['--disable-gpu']],
  ['lang-de-DE', ['--lang=de-DE']],
  ['user-agent-override', ['--user-agent=BrowserCommanderParity/1.0']],
  ['window-size', ['--window-size=1280,720']],
];

// The fields a flag can plausibly move, and where each one lives in the probe
// report. Kept as paths rather than as a chain of `report?.a?.b ?? null` so
// the projection stays a table instead of a fifty-branch function.
const INTERESTING_PATHS = {
  webdriver: ['navigator', 'webdriver'],
  iframeWebdriver: ['iframe', 'webdriver'],
  userAgent: ['navigator', 'userAgent'],
  language: ['navigator', 'language'],
  languages: ['navigator', 'languages'],
  intlLocale: ['intl', 'dateTimeLocale'],
  chromeKeys: ['window', 'chromeKeys'],
  pluginsLength: ['plugins', 'length'],
  notificationPermission: ['permissions', 'notificationPermission'],
  notificationsState: ['permissions', 'states', 'notifications'],
  webglVendor: ['webgl', 'webgl1', 'unmaskedVendor'],
  screen: ['screen'],
  outerWidth: ['window', 'outerWidth'],
  innerWidth: ['window', 'innerWidth'],
  stackLines: ['errors', 'stackLines'],
  suspiciousGlobals: ['window', 'suspiciousGlobals'],
};

const INTERESTING = (report) => projectReport(report, INTERESTING_PATHS, null);

async function main() {
  const probeSource = await readProbeSource();
  const server = await startProbeServer(probeSource);
  const rows = {};
  try {
    for (const [name, extraArgs] of CASES) {
      try {
        const report = await captureReferenceReport({
          executablePath: CHROME,
          server,
          token: `flag-${name}`,
          headless: HEADLESS,
          extraArgs,
        });
        rows[name] = INTERESTING(report);
      } catch (error) {
        rows[name] = { error: String(error && error.message) };
      }
      console.log(`${name}: webdriver=${JSON.stringify(rows[name].webdriver)}`);
    }
  } finally {
    await server.close();
  }
  const outputPath =
    process.argv[2] || path.join(process.cwd(), 'flag-matrix.json');
  await writeFile(outputPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  console.log(`wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
