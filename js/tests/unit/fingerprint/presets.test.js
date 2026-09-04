import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  createFingerprintPreset,
  FINGERPRINT_PRESET_NAMES,
} from '../../../src/fingerprint/presets.js';
import { buildCdpEmulationCommands } from '../../../src/fingerprint/cdp-overrides.js';

describe('fingerprint presets', () => {
  it('names the platforms Chrome ships on', () => {
    assert.deepEqual(
      [...FINGERPRINT_PRESET_NAMES],
      ['android-chrome', 'linux-chrome', 'macos-chrome', 'windows-chrome']
    );
  });

  it('rejects an unknown preset and lists the known ones', () => {
    assert.throws(
      () => createFingerprintPreset('windows-edge'),
      /unknown fingerprint preset "windows-edge".*windows-chrome/su
    );
  });

  it('rejects a Chrome version that is not a dotted number', () => {
    for (const chromeVersion of ['latest', '', 140, '140.x']) {
      assert.throws(
        () => createFingerprintPreset('linux-chrome', { chromeVersion }),
        /dotted numeric version string/u
      );
    }
  });

  it('describes one machine consistently', () => {
    // Every serious fingerprinting script cross-checks these against each
    // other, so a preset is only useful when they agree.
    const expectations = {
      'windows-chrome': {
        platform: 'Win32',
        uaToken: 'Windows NT 10.0',
        hint: 'Windows',
        mobile: false,
      },
      'macos-chrome': {
        platform: 'MacIntel',
        uaToken: 'Mac OS X',
        hint: 'macOS',
        mobile: false,
      },
      'linux-chrome': {
        platform: 'Linux x86_64',
        uaToken: 'X11; Linux x86_64',
        hint: 'Linux',
        mobile: false,
      },
      'android-chrome': {
        platform: 'Linux armv81',
        uaToken: 'Android 15',
        hint: 'Android',
        mobile: true,
      },
    };

    for (const [name, expected] of Object.entries(expectations)) {
      const profile = createFingerprintPreset(name);
      assert.equal(profile.platform, expected.platform, name);
      assert.ok(profile.userAgent.includes(expected.uaToken), name);
      assert.equal(profile.userAgentData.platform, expected.hint, name);
      assert.equal(profile.userAgentData.mobile, expected.mobile, name);
      assert.equal(profile.viewport.mobile, expected.mobile, name);
      assert.equal(
        profile.userAgent.includes('Mobile Safari'),
        expected.mobile,
        name
      );
      assert.deepEqual(
        profile.userAgentData.formFactors,
        [expected.mobile ? 'Mobile' : 'Desktop'],
        name
      );
    }
  });

  it('keeps the viewport inside the screen it claims', () => {
    for (const name of FINGERPRINT_PRESET_NAMES) {
      const { screen, viewport } = createFingerprintPreset(name);
      assert.ok(viewport.width <= screen.width, name);
      assert.ok(viewport.height <= screen.availHeight, name);
      assert.ok(screen.availWidth <= screen.width, name);
      assert.ok(screen.availHeight <= screen.height, name);
    }
  });

  it('gives touch points only to the mobile preset', () => {
    assert.equal(createFingerprintPreset('android-chrome').maxTouchPoints, 5);
    for (const name of ['windows-chrome', 'macos-chrome', 'linux-chrome']) {
      assert.equal(createFingerprintPreset(name).maxTouchPoints, 0, name);
    }
  });

  it('puts the requested Chrome version everywhere it appears', () => {
    const profile = createFingerprintPreset('windows-chrome', {
      chromeVersion: '141.0.7390.55',
    });

    // The user agent carries only the major version, as Chrome freezes it.
    assert.ok(profile.userAgent.includes('Chrome/141.0.0.0'));
    for (const entry of profile.userAgentData.brands) {
      assert.ok(['141', '24'].includes(entry.version), entry.brand);
    }
    assert.ok(
      profile.userAgentData.fullVersionList.some(
        (entry) => entry.version === '141.0.7390.55'
      )
    );
  });

  it('merges caller overrides over the preset', () => {
    const profile = createFingerprintPreset('linux-chrome', {
      overrides: { timezoneId: 'Europe/Lisbon', hardwareConcurrency: 32 },
    });

    assert.equal(profile.timezoneId, 'Europe/Lisbon');
    assert.equal(profile.hardwareConcurrency, 32);
    assert.equal(profile.platform, 'Linux x86_64');
  });

  it('returns a normalized, frozen profile every preset can be applied from', () => {
    for (const name of FINGERPRINT_PRESET_NAMES) {
      const profile = createFingerprintPreset(name);
      assert.ok(Object.isFrozen(profile), name);
      assert.ok(buildCdpEmulationCommands(profile).length > 0, name);
    }
  });
});
