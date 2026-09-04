import { describe, it } from 'node:test';
import assert from 'node:assert';

import { buildCdpEmulationCommands } from '../../../src/fingerprint/cdp-overrides.js';
import { resolveFingerprintProfile } from '../../../src/fingerprint/profile.js';

function methodsOf(profile) {
  return buildCdpEmulationCommands(resolveFingerprintProfile(profile)).map(
    (command) => command.method
  );
}

function paramsOf(profile, method) {
  const command = buildCdpEmulationCommands(
    resolveFingerprintProfile(profile)
  ).find((entry) => entry.method === method);
  return command?.params;
}

describe('CDP emulation commands', () => {
  it('rejects anything that is not a profile object', () => {
    assert.throws(
      () => buildCdpEmulationCommands(null),
      /must be a normalized fingerprint profile/u
    );
    assert.throws(
      () => buildCdpEmulationCommands('windows'),
      /must be a normalized fingerprint profile/u
    );
  });

  it('emits nothing for an empty profile', () => {
    assert.deepEqual(
      buildCdpEmulationCommands(resolveFingerprintProfile({})),
      []
    );
  });

  it('sends only the commands the profile asks for', () => {
    assert.deepEqual(methodsOf({ timezoneId: 'Europe/Berlin' }), [
      'Emulation.setTimezoneOverride',
    ]);
    assert.deepEqual(methodsOf({ hardwareConcurrency: 4 }), [
      'Emulation.setHardwareConcurrencyOverride',
    ]);
  });

  it('keeps a stable command order for a full profile', () => {
    assert.deepEqual(
      methodsOf({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        timezoneId: 'Europe/Berlin',
        locale: 'de-DE',
        hardwareConcurrency: 12,
        screen: { width: 2560, height: 1440 },
        viewport: { width: 1280, height: 720 },
        maxTouchPoints: 0,
        colorScheme: 'dark',
        geolocation: { latitude: 52.52, longitude: 13.405, accuracy: 20 },
      }),
      [
        'Emulation.setUserAgentOverride',
        'Emulation.setTimezoneOverride',
        'Emulation.setLocaleOverride',
        'Emulation.setHardwareConcurrencyOverride',
        'Emulation.setDeviceMetricsOverride',
        'Emulation.setTouchEmulationEnabled',
        'Emulation.setEmulatedMedia',
        'Emulation.setGeolocationOverride',
      ]
    );
  });

  it('supplies the required empty user agent when only the language changes', () => {
    const params = paramsOf(
      { languages: ['fr-FR', 'fr'] },
      'Emulation.setUserAgentOverride'
    );
    // userAgent is a required protocol parameter; an empty string means
    // "leave it alone" while acceptLanguage still takes effect.
    assert.equal(params.userAgent, '');
    assert.equal(params.acceptLanguage, 'fr-FR,fr');
  });

  it('carries the client hints, including the deprecated full version', () => {
    const params = paramsOf(
      {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/140.0.7000.55 Safari/537.36',
        platform: 'Win32',
      },
      'Emulation.setUserAgentOverride'
    );

    assert.equal(params.platform, 'Win32');
    assert.equal(params.userAgentMetadata.platform, 'Windows');
    // fullVersionList does not cover the uaFullVersion hint, so the deprecated
    // fullVersion field has to travel with it.
    assert.equal(params.userAgentMetadata.fullVersion, '140.0.7000.55');
    assert.equal(params.userAgentMetadata.bitness, '64');
    assert.equal(params.userAgentMetadata.wow64, false);
    assert.deepEqual(params.userAgentMetadata.formFactors, ['Desktop']);
  });

  it('always fills the protocol-required metadata fields', () => {
    const params = paramsOf(
      {
        userAgent: 'custom agent',
        userAgentData: { brands: [{ brand: 'Custom', version: '1' }] },
      },
      'Emulation.setUserAgentOverride'
    );

    // Chrome rejects setUserAgentOverride when any of these is missing.
    for (const field of [
      'platform',
      'platformVersion',
      'architecture',
      'model',
      'mobile',
    ]) {
      assert.ok(field in params.userAgentMetadata, `${field} must be present`);
    }
    assert.equal(params.userAgentMetadata.mobile, false);
    assert.ok(!('bitness' in params.userAgentMetadata));
  });

  it('copies the brand entries instead of sharing them with the profile', () => {
    const profile = resolveFingerprintProfile({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    });
    const [{ params }] = buildCdpEmulationCommands(profile);

    assert.notEqual(
      params.userAgentMetadata.brands,
      profile.userAgentData.brands
    );
    assert.notEqual(
      params.userAgentMetadata.brands[0],
      profile.userAgentData.brands[0]
    );
  });

  it('leaves the window size alone when only the screen is described', () => {
    const params = paramsOf(
      { screen: { width: 2560, height: 1440 } },
      'Emulation.setDeviceMetricsOverride'
    );

    // Zeroes mean "no override" for the viewport, so a screen-only profile
    // does not resize the window it was applied to.
    assert.deepEqual(params, {
      width: 0,
      height: 0,
      deviceScaleFactor: 0,
      mobile: false,
      screenWidth: 2560,
      screenHeight: 1440,
    });
  });

  it('sends the viewport without screen dimensions when no screen is set', () => {
    assert.deepEqual(
      paramsOf(
        {
          viewport: {
            width: 1280,
            height: 720,
            deviceScaleFactor: 2,
            mobile: true,
          },
        },
        'Emulation.setDeviceMetricsOverride'
      ),
      { width: 1280, height: 720, deviceScaleFactor: 2, mobile: true }
    );
  });

  it('disables touch emulation for a desktop profile that names zero touch points', () => {
    // maxTouchPoints must stay at least 1 because the protocol rejects 0, so
    // "no touch" is expressed through enabled instead.
    assert.deepEqual(
      paramsOf({ maxTouchPoints: 0 }, 'Emulation.setTouchEmulationEnabled'),
      { enabled: false, maxTouchPoints: 1 }
    );
    assert.deepEqual(
      paramsOf({ maxTouchPoints: 5 }, 'Emulation.setTouchEmulationEnabled'),
      { enabled: true, maxTouchPoints: 5 }
    );
  });

  it('collects every media preference into a single command', () => {
    assert.deepEqual(
      paramsOf(
        {
          colorScheme: 'dark',
          reducedMotion: 'reduce',
          forcedColors: 'active',
        },
        'Emulation.setEmulatedMedia'
      ),
      {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'forced-colors', value: 'active' },
          { name: 'prefers-color-scheme', value: 'dark' },
        ],
      }
    );
  });

  it('passes geolocation through as its own copy', () => {
    const geolocation = { latitude: 48.85, longitude: 2.35, accuracy: 10 };
    const params = paramsOf(
      { geolocation },
      'Emulation.setGeolocationOverride'
    );

    assert.deepEqual(params, geolocation);
    assert.notEqual(params, geolocation);
  });
});
