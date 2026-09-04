/**
 * Ready-made fingerprint profiles for the desktop and mobile platforms Chrome
 * ships on.
 *
 * A profile is only useful if it is internally consistent: the user agent
 * string, the User-Agent Client Hints, `navigator.platform`, the WebGL
 * renderer and the screen size all have to describe the same machine, because
 * every serious fingerprinting script cross-checks them. Each preset below is
 * therefore written as one machine rather than as a bag of independent fields.
 *
 * The Chrome version is a parameter instead of a constant. A profile claiming
 * Chrome 131 while the binary is Chrome 149 is trivially detectable from
 * feature sniffing, so the caller should pass the version of the browser they
 * actually launch.
 */
import { resolveFingerprintProfile } from './profile.js';

const DEFAULT_CHROME_VERSION = '140.0.0.0';

function majorVersion(version) {
  return version.split('.')[0];
}

function brandsFor(version) {
  const major = majorVersion(version);
  return [
    { brand: 'Google Chrome', version: major },
    { brand: 'Chromium', version: major },
    { brand: 'Not)A;Brand', version: '24' },
  ];
}

function fullVersionListFor(version) {
  return [
    { brand: 'Google Chrome', version },
    { brand: 'Chromium', version },
    { brand: 'Not)A;Brand', version: '24.0.0.0' },
  ];
}

function desktopUserAgent(platformToken, version) {
  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion(version)}.0.0.0 Safari/537.36`;
}

const BUILDERS = {
  'windows-chrome': (version) => ({
    userAgent: desktopUserAgent('Windows NT 10.0; Win64; x64', version),
    userAgentData: {
      brands: brandsFor(version),
      fullVersionList: fullVersionListFor(version),
      platform: 'Windows',
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      model: '',
      mobile: false,
      wow64: false,
      formFactors: ['Desktop'],
    },
    platform: 'Win32',
    vendor: 'Google Inc.',
    languages: ['en-US', 'en'],
    locale: 'en-US',
    timezoneId: 'America/New_York',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    screen: {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1032,
      colorDepth: 24,
      pixelDepth: 24,
    },
    viewport: { width: 1920, height: 947, deviceScaleFactor: 1, mobile: false },
    webgl: {
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmaskedVendor: 'Google Inc. (NVIDIA)',
      unmaskedRenderer:
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    },
  }),
  'macos-chrome': (version) => ({
    userAgent: desktopUserAgent('Macintosh; Intel Mac OS X 10_15_7', version),
    userAgentData: {
      brands: brandsFor(version),
      fullVersionList: fullVersionListFor(version),
      platform: 'macOS',
      platformVersion: '15.6.0',
      architecture: 'arm',
      bitness: '64',
      model: '',
      mobile: false,
      wow64: false,
      formFactors: ['Desktop'],
    },
    platform: 'MacIntel',
    vendor: 'Google Inc.',
    languages: ['en-US', 'en'],
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    hardwareConcurrency: 10,
    deviceMemory: 8,
    maxTouchPoints: 0,
    screen: {
      width: 1728,
      height: 1117,
      availWidth: 1728,
      availHeight: 1085,
      colorDepth: 30,
      pixelDepth: 30,
    },
    viewport: {
      width: 1728,
      height: 1005,
      deviceScaleFactor: 2,
      mobile: false,
    },
    webgl: {
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmaskedVendor: 'Google Inc. (Apple)',
      unmaskedRenderer:
        'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)',
    },
  }),
  'linux-chrome': (version) => ({
    userAgent: desktopUserAgent('X11; Linux x86_64', version),
    userAgentData: {
      brands: brandsFor(version),
      fullVersionList: fullVersionListFor(version),
      platform: 'Linux',
      platformVersion: '',
      architecture: 'x86',
      bitness: '64',
      model: '',
      mobile: false,
      wow64: false,
      formFactors: ['Desktop'],
    },
    platform: 'Linux x86_64',
    vendor: 'Google Inc.',
    languages: ['en-US', 'en'],
    locale: 'en-US',
    timezoneId: 'UTC',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    screen: {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1053,
      colorDepth: 24,
      pixelDepth: 24,
    },
    viewport: { width: 1920, height: 955, deviceScaleFactor: 1, mobile: false },
    webgl: {
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmaskedVendor: 'Google Inc. (Intel)',
      unmaskedRenderer:
        'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)',
    },
  }),
  'android-chrome': (version) => ({
    userAgent: `Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${majorVersion(version)}.0.0.0 Mobile Safari/537.36`,
    userAgentData: {
      brands: brandsFor(version),
      fullVersionList: fullVersionListFor(version),
      platform: 'Android',
      platformVersion: '15.0.0',
      architecture: '',
      bitness: '',
      model: 'Pixel 8',
      mobile: true,
      wow64: false,
      formFactors: ['Mobile'],
    },
    platform: 'Linux armv81',
    vendor: 'Google Inc.',
    languages: ['en-US', 'en'],
    locale: 'en-US',
    timezoneId: 'America/New_York',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 5,
    screen: {
      width: 412,
      height: 915,
      availWidth: 412,
      availHeight: 915,
      colorDepth: 24,
      pixelDepth: 24,
    },
    viewport: {
      width: 412,
      height: 823,
      deviceScaleFactor: 2.625,
      mobile: true,
    },
    webgl: {
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmaskedVendor: 'Google Inc. (Qualcomm)',
      unmaskedRenderer: 'ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)',
    },
  }),
};

/** Names accepted by {@link createFingerprintPreset}. */
export const FINGERPRINT_PRESET_NAMES = Object.freeze(
  Object.keys(BUILDERS).sort()
);

/**
 * Build a complete, internally consistent fingerprint profile.
 *
 * @param {string} name One of {@link FINGERPRINT_PRESET_NAMES}.
 * @param {object} [options] Preset options.
 * @param {string} [options.chromeVersion] Full Chrome version, e.g. `'140.0.7339.80'`.
 * @param {object} [options.overrides] Profile fields merged over the preset.
 * @returns {object} Normalized fingerprint profile.
 */
export function createFingerprintPreset(name, options = {}) {
  const builder = BUILDERS[name];
  if (!builder) {
    throw new TypeError(
      `unknown fingerprint preset "${name}"; known presets: ${FINGERPRINT_PRESET_NAMES.join(', ')}`
    );
  }
  const { chromeVersion = DEFAULT_CHROME_VERSION, overrides = {} } = options;
  if (
    typeof chromeVersion !== 'string' ||
    !/^\d+(\.\d+)*$/u.test(chromeVersion)
  ) {
    throw new TypeError(
      'chromeVersion must be a dotted numeric version string'
    );
  }
  return resolveFingerprintProfile({ ...builder(chromeVersion), ...overrides });
}
