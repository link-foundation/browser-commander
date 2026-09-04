/**
 * Two details `Emulation.setUserAgentOverride` gets wrong unless you ask for
 * them explicitly.
 *
 * 1. `acceptLanguage` feeds both the Accept-Language header and
 *    `navigator.languages`, and Chrome splits it on commas without stripping
 *    q-values -- so `de-DE,de;q=0.9` produces the language tag `"de;q=0.9"`,
 *    which no real browser ever reports.
 * 2. `UserAgentMetadata.fullVersionList` does not cover the deprecated
 *    `uaFullVersion` high-entropy hint. Without the deprecated `fullVersion`
 *    field the page still learns the real Chrome build number.
 *
 * Each case reports what the page saw and what the server received.
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
const loadChromium = async () => {
  const loaded = await import(
    new URL(`file://${engineRequire.resolve('playwright')}`).href
  );
  return (loaded.chromium ? loaded : loaded.default).chromium;
};

const METADATA = {
  platform: 'Windows',
  platformVersion: '15.0.0',
  architecture: 'x86',
  model: '',
  mobile: false,
  bitness: '64',
  wow64: false,
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
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const CASES = [
  [
    'accept-language-with-q-values',
    { userAgent: UA, acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8' },
  ],
  ['accept-language-plain-list', { userAgent: UA, acceptLanguage: 'de-DE,de,en' }],
  [
    'accept-language-single-tag',
    { userAgent: UA, acceptLanguage: 'de-DE' },
  ],
  [
    'metadata-without-full-version',
    { userAgent: UA, userAgentMetadata: METADATA },
  ],
  [
    'metadata-with-full-version',
    {
      userAgent: UA,
      userAgentMetadata: { ...METADATA, fullVersion: '140.0.0.0' },
    },
  ],
];

async function main() {
  const chromium = await loadChromium();
  const probeSource = await readProbeSource();
  const server = await startProbeServer(probeSource);
  const rows = {};
  try {
    for (const [name, params] of CASES) {
      const userDataDir = await mkdtemp(path.join(tmpdir(), 'bc-uahints-'));
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
        await session.send('Emulation.setUserAgentOverride', params);
        await page.goto(server.url(name), { waitUntil: 'load' });
        const report = await server.waitForReport(name);
        const headers = server.headersFor(name) || {};
        rows[name] = {
          language: report?.navigator?.language,
          languages: report?.navigator?.languages,
          uaFullVersion: report?.userAgentData?.highEntropy?.uaFullVersion,
          fullVersionList: report?.userAgentData?.highEntropy?.fullVersionList,
          acceptLanguageHeader: headers['accept-language'],
          secChUa: headers['sec-ch-ua'],
        };
        await context.close();
      } catch (error) {
        rows[name] = { error: String(error && error.message).split('\n')[0] };
      } finally {
        await rm(userDataDir, { recursive: true, force: true, maxRetries: 10 });
      }
      console.log(`${name}: ${JSON.stringify(rows[name])}`);
    }
  } finally {
    await server.close();
  }
  const outputPath = process.argv[2] || 'ua-hints-detail.json';
  await writeFile(outputPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  console.log(`wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
