/**
 * Does applying a profile actually change what the page sees, and does the
 * patched environment still look like a real browser?
 *
 * Two questions, two checks:
 *
 * 1. Value check -- every field the profile declares must come back from the
 *    page with the declared value. A silently ignored override is worse than no
 *    override, because the caller believes they are covered.
 * 2. Shape check -- the property descriptors of everything the init script
 *    touches are diffed against a real, unautomated Chrome. Values are supposed
 *    to differ; configurability, enumerability, getter names and the
 *    `[native code]` shape are not.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  captureReferenceReport,
  diffReports,
  readProbeSource,
  readReportPath,
  startProbeServer,
} from './harness.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const HEADLESS = process.env.PARITY_HEADLESS === 'true';
const JS_ROOT = process.env.BC_JS_ROOT || path.resolve('js');

const engineRequire = createRequire(`${JS_ROOT}/package.json`);
const importEngine = async (name) => {
  const loaded = await import(
    new URL(`file://${engineRequire.resolve(name)}`).href
  );
  return loaded.default && !loaded.chromium && !loaded.launch
    ? loaded.default
    : loaded;
};

const PROFILE = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  languages: ['fr-FR', 'fr', 'en'],
  locale: 'fr-FR',
  timezoneId: 'Europe/Paris',
  platform: 'MacIntel',
  vendor: 'Apple Computer, Inc.',
  hardwareConcurrency: 12,
  deviceMemory: 16,
  doNotTrack: '1',
  screen: {
    width: 2560,
    height: 1440,
    availWidth: 2560,
    availHeight: 1415,
    colorDepth: 30,
    pixelDepth: 30,
  },
  webgl: {
    unmaskedVendor: 'Apple Inc.',
    unmaskedRenderer: 'Apple M3 Pro',
  },
  colorScheme: 'dark',
};

/**
 * What the page must report, given the profile above: where the probe reports
 * each value, and what the profile says it should be.
 */
const CHECKS = {
  'navigator.userAgent': {
    path: ['navigator', 'userAgent'],
    expected: PROFILE.userAgent,
  },
  'navigator.platform': {
    path: ['navigator', 'platform'],
    expected: PROFILE.platform,
  },
  'navigator.vendor': {
    path: ['navigator', 'vendor'],
    expected: PROFILE.vendor,
  },
  'navigator.language': { path: ['navigator', 'language'], expected: 'fr-FR' },
  'navigator.languages': {
    path: ['navigator', 'languages'],
    expected: PROFILE.languages,
  },
  'navigator.hardwareConcurrency': {
    path: ['navigator', 'hardwareConcurrency'],
    expected: PROFILE.hardwareConcurrency,
  },
  'navigator.deviceMemory': {
    path: ['navigator', 'deviceMemory'],
    expected: PROFILE.deviceMemory,
  },
  'navigator.doNotTrack': {
    path: ['navigator', 'doNotTrack'],
    expected: PROFILE.doNotTrack,
  },
  'navigator.webdriver': { path: ['navigator', 'webdriver'], expected: false },
  'userAgentData.platform': {
    path: ['userAgentData', 'platform'],
    expected: 'macOS',
  },
  'userAgentData.uaFullVersion': {
    path: ['userAgentData', 'highEntropy', 'uaFullVersion'],
    expected: '141.0.0.0',
  },
  'intl.dateTimeTimeZone': {
    path: ['intl', 'dateTimeTimeZone'],
    expected: PROFILE.timezoneId,
  },
  'intl.dateTimeLocale': {
    path: ['intl', 'dateTimeLocale'],
    expected: PROFILE.locale,
  },
  'screen.width': { path: ['screen', 'width'], expected: PROFILE.screen.width },
  'screen.height': {
    path: ['screen', 'height'],
    expected: PROFILE.screen.height,
  },
  'screen.availHeight': {
    path: ['screen', 'availHeight'],
    expected: PROFILE.screen.availHeight,
  },
  'screen.colorDepth': {
    path: ['screen', 'colorDepth'],
    expected: PROFILE.screen.colorDepth,
  },
  'screen.pixelDepth': {
    path: ['screen', 'pixelDepth'],
    expected: PROFILE.screen.pixelDepth,
  },
  'media.prefers-color-scheme: dark': {
    path: ['mediaQueries', '(prefers-color-scheme: dark)'],
    expected: true,
  },
};

const EXPECTATIONS = (report) =>
  Object.fromEntries(
    Object.entries(CHECKS).map(([name, { path: keyPath, expected }]) => [
      name,
      [readReportPath(report, keyPath), expected],
    ])
  );

async function main() {
  const { applyFingerprint } = await import(
    `file://${JS_ROOT}/src/fingerprint/apply.js`
  );
  const { chromium } = await importEngine('playwright');
  const probeSource = await readProbeSource();
  const server = await startProbeServer(probeSource);
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'bc-parity-apply-'));

  try {
    const reference = await captureReferenceReport({
      executablePath: CHROME,
      server,
      token: 'apply-reference',
      headless: HEADLESS,
    });

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: HEADLESS,
      executablePath: CHROME,
      viewport: null,
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    const page = context.pages()[0] || (await context.newPage());
    const { commands } = await applyFingerprint({
      browser: context,
      page,
      engine: 'playwright',
      profile: PROFILE,
    });
    await page.goto(server.url('apply-profile'), { waitUntil: 'load' });
    const report = await server.waitForReport('apply-profile');
    await context.close();

    const valueMismatches = [];
    for (const [field, [actual, expected]] of Object.entries(
      EXPECTATIONS(report)
    )) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        valueMismatches.push({ field, expected, actual });
      }
    }

    const descriptorDifferences = diffReports(
      { patchedDescriptors: reference.patchedDescriptors },
      { patchedDescriptors: report.patchedDescriptors }
    );

    const output = {
      commands: commands.map((command) => command.method),
      valueMismatches,
      descriptorDifferences,
      nativeFunctions: report.nativeFunctions,
      webdriverDescriptor: report.webdriverDescriptor,
    };
    console.log(JSON.stringify(output, null, 2));
    await writeFile(
      process.argv[2] || 'profile-application.json',
      `${JSON.stringify({ ...output, report, reference }, null, 2)}\n`,
      'utf8'
    );
    console.log(
      `\nvalue mismatches: ${valueMismatches.length}, descriptor differences: ${descriptorDifferences.length}`
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
