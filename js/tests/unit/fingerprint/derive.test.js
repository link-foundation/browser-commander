import { describe, it } from 'node:test';
import assert from 'node:assert';

import { deriveUserAgentData } from '../../../src/fingerprint/derive.js';

describe('client hints derived from a user agent', () => {
  it('returns null when the string names no Chrome version', () => {
    assert.equal(
      deriveUserAgentData(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
          'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
      ),
      null
    );
  });

  it('rejects a non-string user agent', () => {
    assert.throws(() => deriveUserAgentData(undefined), /must be a string/u);
  });

  it('maps a Windows user agent onto the Windows platform hints', () => {
    const data = deriveUserAgentData(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/140.0.7000.55 Safari/537.36'
    );

    assert.equal(data.platform, 'Windows');
    assert.equal(data.architecture, 'x86');
    assert.equal(data.bitness, '64');
    assert.equal(data.mobile, false);
    assert.deepEqual(data.formFactors, ['Desktop']);
    // Chrome froze the user agent at "Windows NT 10.0" and reports the real
    // version only through platformVersion, where 13 and up mean Windows 11.
    assert.equal(data.platformVersion, '15.0.0');
    assert.equal(data.fullVersion, '140.0.7000.55');
  });

  it('pads a major-only Chrome version into a four part full version', () => {
    const data = deriveUserAgentData(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/141 Safari/537.36'
    );

    assert.equal(data.fullVersion, '141.0.0.0');
    assert.deepEqual(
      data.brands.map((entry) => entry.version),
      ['141', '141', '24']
    );
  });

  it('parses the macOS version out of the user agent', () => {
    const data = deriveUserAgentData(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    );

    assert.equal(data.platform, 'macOS');
    assert.equal(data.platformVersion, '10.15.7');
  });

  it('reports an Android phone as mobile and recovers the model', () => {
    const data = deriveUserAgentData(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240105.004) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
    );

    assert.equal(data.platform, 'Android');
    assert.equal(data.platformVersion, '14');
    assert.equal(data.mobile, true);
    assert.equal(data.model, 'Pixel 8');
    assert.deepEqual(data.formFactors, ['Mobile']);
  });

  it('recognises Linux and Chrome OS', () => {
    assert.equal(
      deriveUserAgentData(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
      ).platform,
      'Linux'
    );
    assert.equal(
      deriveUserAgentData(
        'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
      ).platform,
      'Chrome OS'
    );
  });

  it('includes the GREASE brand so the brand list has a real browser shape', () => {
    const data = deriveUserAgentData(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
    );

    assert.equal(data.brands.length, 3);
    assert.ok(data.brands.some((entry) => entry.brand === 'Not=A?Brand'));
    assert.ok(
      data.fullVersionList.every(
        (entry) => entry.version.split('.').length === 4
      )
    );
  });
});
