// feature-parity: attach.open
import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildOpenCommand,
  openInUserBrowser,
  validateOpenUrl,
} from '../../../src/browser/open-in-user-browser.js';
import { openInUserBrowser as publicOpenInUserBrowser } from '../../../src/index.js';

function recordingRunner() {
  const calls = [];
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: '', stderr: '', code: 0 };
  };
  return { calls, runner };
}

describe('validateOpenUrl', () => {
  it('accepts http, https and file URLs', () => {
    assert.equal(
      validateOpenUrl('https://example.com/'),
      'https://example.com/'
    );
    assert.equal(validateOpenUrl('http://example.com'), 'http://example.com');
    assert.equal(validateOpenUrl('file:///tmp/x.html'), 'file:///tmp/x.html');
  });

  it('rejects strings that could be parsed as an option', () => {
    assert.throws(() => validateOpenUrl('--version'), /cannot start with "-"/);
    assert.throws(() => validateOpenUrl('-e'), /cannot start with "-"/);
  });

  it('rejects non-URL strings and disallowed schemes', () => {
    assert.throws(
      () => validateOpenUrl('not a url'),
      /not a valid absolute URL/
    );
    assert.throws(
      () => validateOpenUrl('javascript:alert(1)'),
      /is not one of/
    );
    assert.throws(() => validateOpenUrl(''), /requires a URL string/);
    assert.throws(() => validateOpenUrl(undefined), /requires a URL string/);
  });
});

describe('buildOpenCommand', () => {
  it('uses open on macOS', () => {
    assert.deepEqual(buildOpenCommand('https://x.dev/', 'darwin'), [
      'open',
      'https://x.dev/',
    ]);
  });

  it('uses xdg-open on Linux', () => {
    assert.deepEqual(buildOpenCommand('https://x.dev/', 'linux'), [
      'xdg-open',
      'https://x.dev/',
    ]);
  });

  it('uses Explorer on Windows without parsing URL metacharacters as shell syntax', () => {
    assert.deepEqual(buildOpenCommand('https://x.dev/', 'win32'), [
      'explorer.exe',
      'https://x.dev/',
    ]);
    assert.deepEqual(buildOpenCommand('https://x.dev/?a=1&b=2', 'win32'), [
      'explorer.exe',
      'https://x.dev/?a=1&b=2',
    ]);
  });

  it('throws on an unsupported platform', () => {
    assert.throws(
      () => buildOpenCommand('https://x.dev/', 'sunos'),
      /not supported/
    );
  });
});

describe('openInUserBrowser', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    it(`runs the ${platform} opener and returns the command`, async () => {
      const { calls, runner } = recordingRunner();
      const result = await openInUserBrowser('https://example.com/', {
        platform,
        runner,
      });
      const expected = buildOpenCommand('https://example.com/', platform);
      assert.equal(result.opened, 'https://example.com/');
      assert.deepEqual(result.command, expected);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].file, expected[0]);
      assert.deepEqual(calls[0].args, expected.slice(1));
    });
  }

  it('passes env through to the runner when provided', async () => {
    const { calls, runner } = recordingRunner();
    await openInUserBrowser('https://example.com/', {
      platform: 'linux',
      runner,
      env: { DISPLAY: ':1' },
    });
    assert.deepEqual(calls[0].options, { env: { DISPLAY: ':1' } });
  });

  it('validates before running', async () => {
    const { calls, runner } = recordingRunner();
    await assert.rejects(
      openInUserBrowser('-e', { platform: 'linux', runner }),
      /cannot start with "-"/
    );
    assert.equal(calls.length, 0);
  });

  it('is exported from the package entry point', () => {
    assert.equal(typeof publicOpenInUserBrowser, 'function');
  });
});
