/**
 * Which fingerprint fields does CDP actually enforce?
 *
 * Applies only the `Emulation` commands built by
 * `js/src/fingerprint/cdp-overrides.js` -- no JavaScript patching at all -- and
 * prints what the probe then observes. Anything that does not move is a field
 * that needs an init script, and that is what decides
 * `FINGERPRINT_FIELD_MECHANISMS`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readProbeSource, startProbeServer } from './harness.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const HEADLESS = process.env.PARITY_HEADLESS === 'true';
const JS_ROOT = process.env.BC_JS_ROOT || path.resolve('js');

const engineRequire = createRequire(`${JS_ROOT}/package.json`);
const importEngine = async (name) => {
  const loaded = await import(
    new URL(`file://${engineRequire.resolve(name)}`).href
  );
  return loaded.chromium ? loaded : loaded.default;
};

const TARGET = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  userAgentData: {
    brands: [
      { brand: 'Chromium', version: '140' },
      { brand: 'Google Chrome', version: '140' },
      { brand: 'Not=A?Brand', version: '24' },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: '140.0.0.0' },
      { brand: 'Google Chrome', version: '140.0.0.0' },
      { brand: 'Not=A?Brand', version: '24.0.0.0' },
    ],
    platform: 'Windows',
    platformVersion: '15.0.0',
    architecture: 'x86',
    bitness: '64',
    model: '',
    mobile: false,
    wow64: false,
  },
  acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8',
  languages: ['de-DE', 'de', 'en'],
  locale: 'de-DE',
  timezoneId: 'Europe/Berlin',
  platform: 'Win32',
  vendor: 'Google Inc.',
  hardwareConcurrency: 7,
  deviceMemory: 16,
  maxTouchPoints: 5,
  doNotTrack: '1',
  screen: {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 30,
    pixelDepth: 30,
  },
  webgl: {
    unmaskedVendor: 'Intel Inc.',
    unmaskedRenderer: 'Intel Iris OpenGL',
  },
  colorScheme: 'dark',
  reducedMotion: 'reduce',
  forcedColors: 'active',
  geolocation: { latitude: 52.52, longitude: 13.405, accuracy: 12 },
};

const OBSERVED = (report) => ({
  'navigator.userAgent': report?.navigator?.userAgent,
  'navigator.platform': report?.navigator?.platform,
  'navigator.vendor': report?.navigator?.vendor,
  'navigator.language': report?.navigator?.language,
  'navigator.languages': report?.navigator?.languages,
  'navigator.hardwareConcurrency': report?.navigator?.hardwareConcurrency,
  'navigator.deviceMemory': report?.navigator?.deviceMemory,
  'navigator.maxTouchPoints': report?.navigator?.maxTouchPoints,
  'navigator.doNotTrack': report?.navigator?.doNotTrack,
  'navigator.webdriver': report?.navigator?.webdriver,
  'userAgentData.platform': report?.userAgentData?.platform,
  'userAgentData.brands': report?.userAgentData?.brands,
  'userAgentData.highEntropy': report?.userAgentData?.highEntropy,
  'intl.dateTimeTimeZone': report?.intl?.dateTimeTimeZone,
  'intl.dateTimeLocale': report?.intl?.dateTimeLocale,
  'intl.collatorLocale': report?.intl?.collatorLocale,
  'intl.timezoneOffsetJanuary': report?.intl?.timezoneOffsetJanuary,
  screen: report?.screen,
  'webgl.unmaskedVendor': report?.webgl?.webgl1?.unmaskedVendor,
  'webgl.unmaskedRenderer': report?.webgl?.webgl1?.unmaskedRenderer,
  'media.prefers-color-scheme: dark':
    report?.mediaQueries?.['(prefers-color-scheme: dark)'],
  'media.prefers-reduced-motion: reduce':
    report?.mediaQueries?.['(prefers-reduced-motion: reduce)'],
  'media.forced-colors: active':
    report?.mediaQueries?.['(forced-colors: active)'],
  'media.pointer: coarse': report?.mediaQueries?.['(pointer: coarse)'],
  'media.hover: hover': report?.mediaQueries?.['(hover: hover)'],
  nativeFunctions: report?.nativeFunctions,
});

async function main() {
  const { buildCdpEmulationCommands } = await import(
    `file://${JS_ROOT}/src/fingerprint/cdp-overrides.js`
  );
  const { chromium } = await importEngine('playwright');
  const probeSource = await readProbeSource();
  const server = await startProbeServer(probeSource);
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'bc-parity-cov-'));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: HEADLESS,
      executablePath: CHROME,
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    const page = context.pages()[0] || (await context.newPage());
    const session = await context.newCDPSession(page);

    const commands = buildCdpEmulationCommands(TARGET);
    const applied = {};
    for (const { method, params } of commands) {
      try {
        await session.send(method, params);
        applied[method] = 'ok';
      } catch (error) {
        applied[method] = String(error && error.message).split('\n')[0];
      }
    }

    await page.goto(server.url('coverage'), { waitUntil: 'load' });
    const report = await server.waitForReport('coverage');
    await context.close();

    const observed = OBSERVED(report);
    const output = { commands, applied, observed };
    console.log(JSON.stringify(output, null, 2));
    await writeFile(
      process.argv[2] || 'override-coverage.json',
      `${JSON.stringify(output, null, 2)}\n`,
      'utf8'
    );
  } finally {
    await server.close();
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 10 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
