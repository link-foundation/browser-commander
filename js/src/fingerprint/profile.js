/**
 * A fingerprint profile is the complete description of the environment a page
 * is allowed to see: who the browser claims to be, where it claims to run, and
 * what hardware it claims to have.
 *
 * Every field here is applied through a documented mechanism - a Chrome
 * switch, a CDP `Emulation` command, or a page init script - and the mechanism
 * is recorded in `FINGERPRINT_FIELD_MECHANISMS` so callers can tell an
 * override the browser enforces from an override that is only a JavaScript
 * patch. See `limitations.js` for the surfaces that have no mechanism at all.
 */

import { deriveUserAgentData } from './derive.js';

const BRAND_KEYS = ['brand', 'version'];

function fail(message) {
  throw new TypeError(message);
}

function optionalString(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    fail(`${name} must be a string`);
  }
  return value;
}

function optionalBoolean(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    fail(`${name} must be a boolean`);
  }
  return value;
}

function optionalPositiveInteger(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${name} must be a positive integer`);
  }
  return value;
}

function optionalNonNegativeInteger(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0) {
    fail(`${name} must be a non-negative integer`);
  }
  return value;
}

function optionalPositiveNumber(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${name} must be a positive number`);
  }
  return value;
}

function optionalStringArray(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    fail(`${name} must be an array of strings`);
  }
  if (value.length === 0) {
    fail(`${name} must not be empty`);
  }
  return [...value];
}

function optionalBrands(value, name) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    fail(`${name} must be an array of { brand, version } entries`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      fail(`${name}[${index}] must be an object`);
    }
    for (const key of BRAND_KEYS) {
      if (typeof entry[key] !== 'string') {
        fail(`${name}[${index}].${key} must be a string`);
      }
    }
    return { brand: entry.brand, version: entry.version };
  });
}

function optionalEnum(value, name, allowed) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!allowed.includes(value)) {
    fail(`${name} must be one of ${allowed.join(', ')}`);
  }
  return value;
}

function compact(object) {
  const result = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function resolveScreen(screen) {
  if (screen === undefined || screen === null) {
    return undefined;
  }
  if (typeof screen !== 'object') {
    fail('screen must be an object');
  }
  const resolved = compact({
    width: optionalPositiveInteger(screen.width, 'screen.width'),
    height: optionalPositiveInteger(screen.height, 'screen.height'),
    availWidth: optionalPositiveInteger(screen.availWidth, 'screen.availWidth'),
    availHeight: optionalPositiveInteger(
      screen.availHeight,
      'screen.availHeight'
    ),
    colorDepth: optionalPositiveInteger(screen.colorDepth, 'screen.colorDepth'),
    pixelDepth: optionalPositiveInteger(screen.pixelDepth, 'screen.pixelDepth'),
  });
  if ((resolved.width === undefined) !== (resolved.height === undefined)) {
    fail('screen.width and screen.height must be provided together');
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function resolveViewport(viewport) {
  if (viewport === undefined || viewport === null) {
    return undefined;
  }
  if (typeof viewport !== 'object') {
    fail('viewport must be an object');
  }
  const resolved = compact({
    width: optionalPositiveInteger(viewport.width, 'viewport.width'),
    height: optionalPositiveInteger(viewport.height, 'viewport.height'),
    deviceScaleFactor: optionalPositiveNumber(
      viewport.deviceScaleFactor,
      'viewport.deviceScaleFactor'
    ),
    mobile: optionalBoolean(viewport.mobile, 'viewport.mobile'),
  });
  if ((resolved.width === undefined) !== (resolved.height === undefined)) {
    fail('viewport.width and viewport.height must be provided together');
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

function resolveGeolocation(geolocation) {
  if (geolocation === undefined || geolocation === null) {
    return undefined;
  }
  if (typeof geolocation !== 'object') {
    fail('geolocation must be an object');
  }
  const { latitude, longitude, accuracy } = geolocation;
  for (const [value, name] of [
    [latitude, 'geolocation.latitude'],
    [longitude, 'geolocation.longitude'],
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`${name} must be a finite number`);
    }
  }
  if (latitude < -90 || latitude > 90) {
    fail('geolocation.latitude must be between -90 and 90');
  }
  if (longitude < -180 || longitude > 180) {
    fail('geolocation.longitude must be between -180 and 180');
  }
  return compact({
    latitude,
    longitude,
    accuracy: optionalPositiveNumber(accuracy, 'geolocation.accuracy'),
  });
}

function resolveWebgl(webgl) {
  if (webgl === undefined || webgl === null) {
    return undefined;
  }
  if (typeof webgl !== 'object') {
    fail('webgl must be an object');
  }
  const resolved = compact({
    vendor: optionalString(webgl.vendor, 'webgl.vendor'),
    renderer: optionalString(webgl.renderer, 'webgl.renderer'),
    unmaskedVendor: optionalString(
      webgl.unmaskedVendor,
      'webgl.unmaskedVendor'
    ),
    unmaskedRenderer: optionalString(
      webgl.unmaskedRenderer,
      'webgl.unmaskedRenderer'
    ),
  });
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

/**
 * Chrome derives both the Accept-Language header and `navigator.languages`
 * from this one string, and it splits on commas without stripping q-values.
 * Passing `de-DE,de;q=0.9` therefore yields the language tag `"de;q=0.9"` and
 * the header `de-DE,de;q=0.9;q=0.9`; passing the plain list `de-DE,de,en`
 * yields correct tags and the header `de-DE,de;q=0.9,en;q=0.8` that a real
 * browser sends. Measured in
 * `docs/case-studies/issue-79/analysis-artifacts/ua-hints-detail.json`.
 */
function resolveAcceptLanguage(acceptLanguage) {
  if (acceptLanguage === undefined) {
    return undefined;
  }
  if (acceptLanguage.includes(';')) {
    fail(
      'acceptLanguage must be a plain comma-separated language list without ' +
        'q-values; Chrome generates the quality values itself'
    );
  }
  return acceptLanguage;
}

/** Keep `uaFullVersion` consistent with `fullVersionList`. */
function withFullVersion(userAgentData) {
  if (!userAgentData || userAgentData.fullVersion !== undefined) {
    return userAgentData;
  }
  const primary = userAgentData.fullVersionList?.find(
    (entry) => entry.brand === 'Google Chrome' || entry.brand === 'Chromium'
  );
  return primary
    ? { ...userAgentData, fullVersion: primary.version }
    : userAgentData;
}

function resolveUserAgentData(userAgentData) {
  if (userAgentData === undefined || userAgentData === null) {
    return undefined;
  }
  if (typeof userAgentData !== 'object') {
    fail('userAgentData must be an object');
  }
  const resolved = compact({
    brands: optionalBrands(userAgentData.brands, 'userAgentData.brands'),
    fullVersionList: optionalBrands(
      userAgentData.fullVersionList,
      'userAgentData.fullVersionList'
    ),
    platform: optionalString(userAgentData.platform, 'userAgentData.platform'),
    platformVersion: optionalString(
      userAgentData.platformVersion,
      'userAgentData.platformVersion'
    ),
    architecture: optionalString(
      userAgentData.architecture,
      'userAgentData.architecture'
    ),
    bitness: optionalString(userAgentData.bitness, 'userAgentData.bitness'),
    // Deprecated in the protocol but still the only way to control the
    // `uaFullVersion` high-entropy hint: with `fullVersionList` alone the page
    // still reads the real Chrome build number.
    fullVersion: optionalString(
      userAgentData.fullVersion,
      'userAgentData.fullVersion'
    ),
    model: optionalString(userAgentData.model, 'userAgentData.model'),
    mobile: optionalBoolean(userAgentData.mobile, 'userAgentData.mobile'),
    wow64: optionalBoolean(userAgentData.wow64, 'userAgentData.wow64'),
    formFactors: optionalStringArray(
      userAgentData.formFactors,
      'userAgentData.formFactors'
    ),
  });
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

/**
 * Normalize and validate a fingerprint profile.
 *
 * Unknown keys are rejected rather than ignored: a typo in `hardwareConcurency`
 * would otherwise silently leave the real core count exposed, which is exactly
 * the failure this module exists to prevent.
 *
 * @param {object} [input] Raw profile.
 * @returns {object} Frozen, normalized profile.
 */
export function resolveFingerprintProfile(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('fingerprint profile must be an object');
  }

  const known = new Set([
    'userAgent',
    'userAgentData',
    'acceptLanguage',
    'languages',
    'locale',
    'timezoneId',
    'platform',
    'vendor',
    'hardwareConcurrency',
    'deviceMemory',
    'maxTouchPoints',
    'doNotTrack',
    'screen',
    'viewport',
    'webgl',
    'geolocation',
    'colorScheme',
    'reducedMotion',
    'forcedColors',
  ]);
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      fail(
        `unknown fingerprint profile field "${key}"; known fields: ${[...known].sort().join(', ')}`
      );
    }
  }

  const languages = optionalStringArray(input.languages, 'languages');
  const acceptLanguage = resolveAcceptLanguage(
    optionalString(input.acceptLanguage, 'acceptLanguage') ??
      (languages ? languages.join(',') : undefined)
  );
  const userAgent = optionalString(input.userAgent, 'userAgent');
  const userAgentData =
    resolveUserAgentData(input.userAgentData) ??
    (userAgent === undefined ? undefined : deriveUserAgentData(userAgent));

  return Object.freeze(
    compact({
      userAgent,
      userAgentData: withFullVersion(userAgentData),
      acceptLanguage,
      languages,
      locale: optionalString(input.locale, 'locale'),
      timezoneId: optionalString(input.timezoneId, 'timezoneId'),
      platform: optionalString(input.platform, 'platform'),
      vendor: optionalString(input.vendor, 'vendor'),
      hardwareConcurrency: optionalPositiveInteger(
        input.hardwareConcurrency,
        'hardwareConcurrency'
      ),
      deviceMemory: optionalPositiveNumber(input.deviceMemory, 'deviceMemory'),
      maxTouchPoints: optionalNonNegativeInteger(
        input.maxTouchPoints,
        'maxTouchPoints'
      ),
      doNotTrack: optionalString(input.doNotTrack, 'doNotTrack'),
      screen: resolveScreen(input.screen),
      viewport: resolveViewport(input.viewport),
      webgl: resolveWebgl(input.webgl),
      geolocation: resolveGeolocation(input.geolocation),
      colorScheme: optionalEnum(input.colorScheme, 'colorScheme', [
        'light',
        'dark',
        'no-preference',
      ]),
      reducedMotion: optionalEnum(input.reducedMotion, 'reducedMotion', [
        'reduce',
        'no-preference',
      ]),
      forcedColors: optionalEnum(input.forcedColors, 'forcedColors', [
        'active',
        'none',
      ]),
    })
  );
}

/**
 * How each profile field reaches the page.
 *
 * `browser` means Chrome itself produces the value, so it is consistent
 * everywhere including workers and HTTP headers. `script` means the value is a
 * JavaScript property patch installed before page scripts run, which is
 * weaker: it is consistent for the main world but is not what the network
 * stack or a fresh renderer would say.
 */
export const FINGERPRINT_FIELD_MECHANISMS = Object.freeze({
  userAgent: 'browser',
  userAgentData: 'browser',
  acceptLanguage: 'browser',
  languages: 'browser',
  locale: 'browser',
  timezoneId: 'browser',
  hardwareConcurrency: 'browser',
  screen: 'browser',
  viewport: 'browser',
  maxTouchPoints: 'browser',
  geolocation: 'browser',
  colorScheme: 'browser',
  reducedMotion: 'browser',
  forcedColors: 'browser',
  platform: 'browser',
  vendor: 'script',
  deviceMemory: 'script',
  doNotTrack: 'script',
  webgl: 'script',
});
