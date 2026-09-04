import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  FINGERPRINT_FIELD_MECHANISMS,
  resolveFingerprintProfile,
} from '../../../src/fingerprint/profile.js';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

describe('fingerprint profile', () => {
  it('returns an empty frozen profile for an empty input', () => {
    const profile = resolveFingerprintProfile();

    assert.deepEqual(profile, {});
    assert.ok(Object.isFrozen(profile));
  });

  it('drops fields that were not supplied instead of filling in defaults', () => {
    const profile = resolveFingerprintProfile({ locale: 'de-DE' });

    assert.deepEqual(Object.keys(profile), ['locale']);
  });

  it('rejects an unknown field rather than silently ignoring it', () => {
    assert.throws(
      () => resolveFingerprintProfile({ hardwareConcurency: 8 }),
      /unknown fingerprint profile field "hardwareConcurency"/u
    );
  });

  it('rejects a profile that is not a plain object', () => {
    for (const input of [null, [], 'profile', 42]) {
      assert.throws(
        () => resolveFingerprintProfile(input),
        /fingerprint profile must be an object/u
      );
    }
  });

  it('derives acceptLanguage from languages when only languages is given', () => {
    const profile = resolveFingerprintProfile({
      languages: ['de-DE', 'de', 'en'],
    });

    assert.equal(profile.acceptLanguage, 'de-DE,de,en');
    assert.deepEqual(profile.languages, ['de-DE', 'de', 'en']);
  });

  it('keeps an explicit acceptLanguage over the derived one', () => {
    const profile = resolveFingerprintProfile({
      languages: ['de-DE', 'de'],
      acceptLanguage: 'fr-FR,fr',
    });

    assert.equal(profile.acceptLanguage, 'fr-FR,fr');
  });

  // Chrome splits acceptLanguage on commas without stripping q-values, so a
  // q-value ends up inside a language tag and doubled in the header.
  it('rejects q-values in acceptLanguage, which Chrome would misparse', () => {
    assert.throws(
      () => resolveFingerprintProfile({ acceptLanguage: 'de-DE,de;q=0.9' }),
      /must be a plain comma-separated language list without q-values/u
    );
  });

  it('derives client hints from a Chrome user agent', () => {
    const profile = resolveFingerprintProfile({ userAgent: CHROME_UA });

    assert.equal(profile.userAgentData.platform, 'Windows');
    assert.equal(profile.userAgentData.architecture, 'x86');
    assert.equal(profile.userAgentData.bitness, '64');
    assert.equal(profile.userAgentData.mobile, false);
    assert.ok(
      profile.userAgentData.brands.some(
        (entry) => entry.brand === 'Google Chrome' && entry.version === '140'
      )
    );
  });

  it('fills uaFullVersion from the Chrome entry of fullVersionList', () => {
    const profile = resolveFingerprintProfile({
      userAgentData: {
        fullVersionList: [
          { brand: 'Not=A?Brand', version: '24.0.0.0' },
          { brand: 'Google Chrome', version: '140.0.7000.1' },
        ],
      },
    });

    assert.equal(profile.userAgentData.fullVersion, '140.0.7000.1');
  });

  it('keeps an explicit fullVersion instead of deriving one', () => {
    const profile = resolveFingerprintProfile({
      userAgentData: {
        fullVersion: '99.1.2.3',
        fullVersionList: [{ brand: 'Google Chrome', version: '140.0.0.0' }],
      },
    });

    assert.equal(profile.userAgentData.fullVersion, '99.1.2.3');
  });

  it('lets an explicit userAgentData win over the one derived from the user agent', () => {
    const profile = resolveFingerprintProfile({
      userAgent: CHROME_UA,
      userAgentData: { platform: 'macOS' },
    });

    assert.equal(profile.userAgentData.platform, 'macOS');
  });

  it('accepts every configurable field at once', () => {
    const profile = resolveFingerprintProfile({
      userAgent: CHROME_UA,
      languages: ['de-DE', 'de'],
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      platform: 'Win32',
      vendor: 'Google Inc.',
      hardwareConcurrency: 24,
      deviceMemory: 32,
      maxTouchPoints: 5,
      doNotTrack: '1',
      screen: {
        width: 3840,
        height: 2160,
        availWidth: 3840,
        availHeight: 2100,
        colorDepth: 30,
        pixelDepth: 30,
      },
      viewport: {
        width: 1600,
        height: 900,
        deviceScaleFactor: 2,
        mobile: false,
      },
      webgl: { unmaskedVendor: 'NVIDIA', unmaskedRenderer: 'RTX 4090' },
      geolocation: { latitude: 52.52, longitude: 13.405, accuracy: 12 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      forcedColors: 'active',
    });

    assert.equal(profile.hardwareConcurrency, 24);
    assert.equal(profile.deviceMemory, 32);
    assert.equal(profile.screen.colorDepth, 30);
    assert.equal(profile.viewport.deviceScaleFactor, 2);
    assert.equal(profile.webgl.unmaskedRenderer, 'RTX 4090');
    assert.equal(profile.geolocation.accuracy, 12);
    assert.equal(profile.forcedColors, 'active');
  });

  it('rejects a hardwareConcurrency that is not a positive integer', () => {
    for (const value of [0, -4, 2.5, '8']) {
      assert.throws(
        () => resolveFingerprintProfile({ hardwareConcurrency: value }),
        /hardwareConcurrency must be a positive integer/u
      );
    }
  });

  it('allows maxTouchPoints to be zero but not negative', () => {
    assert.equal(
      resolveFingerprintProfile({ maxTouchPoints: 0 }).maxTouchPoints,
      0
    );
    assert.throws(
      () => resolveFingerprintProfile({ maxTouchPoints: -1 }),
      /maxTouchPoints must be a non-negative integer/u
    );
  });

  it('requires screen width and height to be given together', () => {
    assert.throws(
      () => resolveFingerprintProfile({ screen: { width: 1920 } }),
      /screen.width and screen.height must be provided together/u
    );
  });

  it('requires viewport width and height to be given together', () => {
    assert.throws(
      () => resolveFingerprintProfile({ viewport: { height: 900 } }),
      /viewport.width and viewport.height must be provided together/u
    );
  });

  it('rejects out-of-range coordinates', () => {
    assert.throws(
      () =>
        resolveFingerprintProfile({
          geolocation: { latitude: 91, longitude: 0 },
        }),
      /latitude must be between -90 and 90/u
    );
    assert.throws(
      () =>
        resolveFingerprintProfile({
          geolocation: { latitude: 0, longitude: -181 },
        }),
      /longitude must be between -180 and 180/u
    );
  });

  it('rejects an unsupported enum value', () => {
    assert.throws(
      () => resolveFingerprintProfile({ colorScheme: 'sepia' }),
      /colorScheme must be one of light, dark, no-preference/u
    );
  });

  it('rejects an empty languages array', () => {
    assert.throws(
      () => resolveFingerprintProfile({ languages: [] }),
      /languages must not be empty/u
    );
  });

  it('rejects a brand entry with a non-string version', () => {
    assert.throws(
      () =>
        resolveFingerprintProfile({
          userAgentData: { brands: [{ brand: 'Chromium', version: 140 }] },
        }),
      /userAgentData.brands\[0\].version must be a string/u
    );
  });

  it('treats null the same as an omitted field', () => {
    const profile = resolveFingerprintProfile({
      locale: null,
      screen: null,
      webgl: null,
    });

    assert.deepEqual(profile, {});
  });

  it('copies arrays so a later mutation of the input cannot reach the profile', () => {
    const languages = ['de-DE', 'de'];
    const profile = resolveFingerprintProfile({ languages });
    languages.push('en');

    assert.deepEqual(profile.languages, ['de-DE', 'de']);
  });

  it('records a mechanism for every field the profile accepts', () => {
    const everyField = resolveFingerprintProfile({
      userAgent: CHROME_UA,
      acceptLanguage: 'en-US,en',
      languages: ['en-US', 'en'],
      locale: 'en-US',
      timezoneId: 'UTC',
      platform: 'Win32',
      vendor: 'Google Inc.',
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      doNotTrack: '1',
      screen: { width: 1920, height: 1080 },
      viewport: { width: 1280, height: 720 },
      webgl: { unmaskedVendor: 'Intel' },
      geolocation: { latitude: 0, longitude: 0 },
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      forcedColors: 'active',
    });

    for (const field of Object.keys(everyField)) {
      assert.ok(
        FINGERPRINT_FIELD_MECHANISMS[field] === 'browser' ||
          FINGERPRINT_FIELD_MECHANISMS[field] === 'script',
        `no mechanism recorded for "${field}"`
      );
    }
  });
});
