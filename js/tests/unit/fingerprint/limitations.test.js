import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  FINGERPRINT_LIMITATIONS,
  findFingerprintLimitation,
  relevantFingerprintLimitations,
} from '../../../src/fingerprint/limitations.js';

const ids = (limitations) => limitations.map((limitation) => limitation.id);

describe('the documented limitations', () => {
  it('gives every entry a unique id and the fields a reader needs', () => {
    const seen = new Set();
    for (const limitation of FINGERPRINT_LIMITATIONS) {
      assert.ok(!seen.has(limitation.id), `duplicate id ${limitation.id}`);
      seen.add(limitation.id);
      assert.ok(limitation.surface.length > 0, limitation.id);
      assert.ok(limitation.detail.length > 0, limitation.id);
      assert.ok(
        ['high', 'medium', 'low'].includes(limitation.severity),
        limitation.id
      );
      assert.ok(
        ['measured', 'documented'].includes(limitation.evidence),
        limitation.id
      );
    }
  });

  it('points every measured entry at the artifact that proves it', () => {
    for (const limitation of FINGERPRINT_LIMITATIONS) {
      if (limitation.evidence === 'measured') {
        assert.ok(limitation.reference, `${limitation.id} needs a reference`);
      }
    }
  });

  it('cannot be edited by a caller', () => {
    assert.ok(Object.isFrozen(FINGERPRINT_LIMITATIONS));
    assert.ok(FINGERPRINT_LIMITATIONS.every((entry) => Object.isFrozen(entry)));
  });

  it('looks an entry up by id', () => {
    assert.equal(
      findFingerprintLimitation('webgl-strings-only').surface,
      'WebGL renderer strings and driver limits'
    );
    assert.equal(findFingerprintLimitation('no-such-limitation'), undefined);
  });
});

describe('limitations relevant to a profile', () => {
  it('always reports the two nothing can be done about', () => {
    assert.deepEqual(ids(relevantFingerprintLimitations()), [
      'canvas-audio-font-follow-the-host',
      'network-layer-not-covered',
    ]);
  });

  it("mentions the launch-only switch only when attaching to someone else's browser", () => {
    assert.ok(
      !ids(relevantFingerprintLimitations({}, {})).includes(
        'automation-controlled-is-launch-only'
      )
    );
    assert.ok(
      ids(relevantFingerprintLimitations({}, { attached: true })).includes(
        'automation-controlled-is-launch-only'
      )
    );
  });

  it('mentions headless only for a headless browser', () => {
    assert.ok(
      ids(relevantFingerprintLimitations({}, { headless: true })).includes(
        'headless-is-distinguishable'
      )
    );
  });

  it('mentions the JavaScript-only fields when the profile sets them', () => {
    assert.ok(
      ids(relevantFingerprintLimitations({ deviceMemory: 8 })).includes(
        'no-cdp-device-memory-override'
      )
    );
    assert.ok(
      ids(relevantFingerprintLimitations({ doNotTrack: '1' })).includes(
        'no-cdp-vendor-or-dnt-override'
      )
    );
    assert.ok(
      ids(
        relevantFingerprintLimitations({ webgl: { vendor: 'WebKit' } })
      ).includes('webgl-strings-only')
    );
  });

  it('mentions the screen entry only for the fields CDP does not emulate', () => {
    assert.ok(
      !ids(
        relevantFingerprintLimitations({
          screen: { width: 1920, height: 1080 },
        })
      ).includes('screen-depth-and-avail-not-emulated')
    );
    assert.ok(
      ids(
        relevantFingerprintLimitations({
          screen: { width: 1920, height: 1080, availHeight: 1032 },
        })
      ).includes('screen-depth-and-avail-not-emulated')
    );
  });

  it('mentions the pointer side effect only when touch is actually enabled', () => {
    assert.ok(
      !ids(relevantFingerprintLimitations({ maxTouchPoints: 0 })).includes(
        'touch-emulation-changes-pointer-media'
      )
    );
    assert.ok(
      ids(relevantFingerprintLimitations({ maxTouchPoints: 5 })).includes(
        'touch-emulation-changes-pointer-media'
      )
    );
  });

  it('mentions workers for every field a worker reads differently', () => {
    // Measured in worker-visibility.json: platform, languages and
    // hardwareConcurrency revert to the host values inside a worker even
    // though the page session overrides them.
    for (const profile of [
      { platform: 'Win32' },
      { languages: ['de-DE'] },
      { hardwareConcurrency: 8 },
      { deviceMemory: 8 },
    ]) {
      assert.ok(
        ids(relevantFingerprintLimitations(profile)).includes(
          'init-script-does-not-reach-workers'
        ),
        JSON.stringify(profile)
      );
    }
    assert.ok(
      !ids(relevantFingerprintLimitations({ timezoneId: 'UTC' })).includes(
        'init-script-does-not-reach-workers'
      )
    );
  });

  it('keeps the declaration order and returns a frozen list', () => {
    const relevant = relevantFingerprintLimitations(
      { deviceMemory: 8, webgl: { vendor: 'WebKit' } },
      { headless: true, attached: true }
    );

    assert.ok(Object.isFrozen(relevant));
    assert.deepEqual(
      ids(relevant),
      ids(
        FINGERPRINT_LIMITATIONS.filter((entry) =>
          ids(relevant).includes(entry.id)
        )
      )
    );
  });
});
