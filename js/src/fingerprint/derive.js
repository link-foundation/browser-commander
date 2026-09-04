/**
 * Derive User-Agent Client Hints from a User-Agent string.
 *
 * This exists because of a measured trap: `Emulation.setUserAgentOverride`
 * replaces the whole identity, so overriding `userAgent` *without*
 * `userAgentMetadata` leaves `navigator.userAgentData.brands` empty and
 * `getHighEntropyValues(['fullVersionList'])` returning `[]`. A real browser
 * never reports that combination, so a bare UA override is a louder automation
 * signal than the default UA it replaced. See
 * `docs/case-studies/issue-79/analysis-artifacts/ua-hints-detail.json`.
 *
 * Deriving is best effort. Chrome's GREASE brand -- the `Not=A?Brand` entry --
 * is generated from a per-version permutation table that this module does not
 * reproduce; `limitations.js` records that.
 */

const CHROME_VERSION = /Chrome\/(\d+)(?:\.(\d+)\.(\d+)\.(\d+))?/u;

const GREASE_BRAND = 'Not=A?Brand';
const GREASE_VERSION = '24';

function platformFromUserAgent(userAgent) {
  if (/Windows NT/u.test(userAgent)) {
    return { platform: 'Windows', architecture: 'x86', bitness: '64' };
  }
  if (/Android/u.test(userAgent)) {
    return { platform: 'Android', architecture: '', bitness: '' };
  }
  if (/(Macintosh|Mac OS X)/u.test(userAgent)) {
    return { platform: 'macOS', architecture: 'arm', bitness: '64' };
  }
  if (/CrOS/u.test(userAgent)) {
    return { platform: 'Chrome OS', architecture: 'x86', bitness: '64' };
  }
  if (/(X11|Linux)/u.test(userAgent)) {
    return { platform: 'Linux', architecture: 'x86', bitness: '64' };
  }
  return { platform: '', architecture: '', bitness: '' };
}

function platformVersionFromUserAgent(userAgent, platform) {
  if (platform === 'Windows') {
    // Chrome freezes the UA string at "Windows NT 10.0" and moves the real
    // version into the platformVersion hint: 13+ means Windows 11.
    return /Windows NT 10\.0/u.test(userAgent) ? '15.0.0' : '0.0.0';
  }
  if (platform === 'macOS') {
    const match = /Mac OS X (\d+)[._](\d+)(?:[._](\d+))?/u.exec(userAgent);
    return match ? `${match[1]}.${match[2]}.${match[3] || '0'}` : '';
  }
  if (platform === 'Android') {
    const match = /Android (\d+(?:\.\d+)*)/u.exec(userAgent);
    return match ? match[1] : '';
  }
  return '';
}

/**
 * Build a complete `userAgentData` block for a Chrome User-Agent string.
 *
 * @param {string} userAgent A Chrome or Chromium User-Agent string.
 * @returns {object|null} Client hints, or `null` when the string does not name
 *   a Chrome version and there is nothing trustworthy to derive.
 */
export function deriveUserAgentData(userAgent) {
  if (typeof userAgent !== 'string') {
    throw new TypeError('userAgent must be a string');
  }
  const version = CHROME_VERSION.exec(userAgent);
  if (!version) {
    return null;
  }
  const major = version[1];
  const full = version[2]
    ? version[0].slice('Chrome/'.length)
    : `${major}.0.0.0`;
  const { platform, architecture, bitness } = platformFromUserAgent(userAgent);
  const mobile = /Mobile/u.test(userAgent);
  const model = mobile
    ? (/; ([^;)]+) Build\//u.exec(userAgent)?.[1] ?? '')
    : '';

  return {
    brands: [
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major },
      { brand: GREASE_BRAND, version: GREASE_VERSION },
    ],
    fullVersionList: [
      { brand: 'Chromium', version: full },
      { brand: 'Google Chrome', version: full },
      { brand: GREASE_BRAND, version: `${GREASE_VERSION}.0.0.0` },
    ],
    fullVersion: full,
    platform,
    platformVersion: platformVersionFromUserAgent(userAgent, platform),
    architecture,
    bitness,
    model,
    mobile,
    wow64: false,
    formFactors: [mobile ? 'Mobile' : 'Desktop'],
  };
}
