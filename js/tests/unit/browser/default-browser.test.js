// feature-parity: sources.default-browser@native-typed
import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  browserForIdentifier,
  parseMacLaunchServicesHandler,
  parseWindowsProgId,
  resolveDefaultBrowser,
} from '../../../src/browser/default-browser.js';

function runnerReturning(map) {
  return async (command, args) => {
    const key = [command, ...args].join(' ');
    if (!(key in map)) {
      throw new Error(`unexpected command: ${key}`);
    }
    return map[key];
  };
}

describe('resolveDefaultBrowser', () => {
  it('maps a macOS LaunchServices https handler to a browser id', async () => {
    const output = `(
      {
        LSHandlerRoleAll = "com.apple.safari";
        LSHandlerURLScheme = mailto;
      },
      {
        LSHandlerRoleAll = "com.google.chrome";
        LSHandlerURLScheme = https;
      }
    )`;
    const runCommand = runnerReturning({
      'defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers':
        output,
    });
    assert.equal(
      await resolveDefaultBrowser({ platform: 'darwin', runCommand }),
      'chrome'
    );
  });

  it('maps a Linux xdg-settings .desktop name to a browser id', async () => {
    const runCommand = runnerReturning({
      'xdg-settings get default-web-browser': 'firefox.desktop\n',
    });
    assert.equal(
      await resolveDefaultBrowser({ platform: 'linux', runCommand }),
      'firefox'
    );
  });

  it('falls back to xdg-mime when xdg-settings is unknown', async () => {
    const runCommand = async (command, args) => {
      const key = [command, ...args].join(' ');
      if (key === 'xdg-settings get default-web-browser') {
        return 'some-unknown.desktop\n';
      }
      if (key === 'xdg-mime query default x-scheme-handler/https') {
        return 'brave-browser.desktop\n';
      }
      throw new Error(`unexpected command: ${key}`);
    };
    assert.equal(
      await resolveDefaultBrowser({ platform: 'linux', runCommand }),
      'brave'
    );
  });

  it('maps a Windows UserChoice ProgId to a browser id', async () => {
    const output = [
      '',
      'HKEY_CURRENT_USER\\...\\https\\UserChoice',
      '    ProgId    REG_SZ    MSEdgeHTM',
      '',
    ].join('\r\n');
    const runCommand = runnerReturning({
      'reg query HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice /v ProgId':
        output,
    });
    assert.equal(
      await resolveDefaultBrowser({ platform: 'win32', runCommand }),
      'edge'
    );
  });

  it('returns null when nothing matches or the tool fails', async () => {
    assert.equal(
      await resolveDefaultBrowser({
        platform: 'linux',
        runCommand: async () => {
          throw new Error('no xdg');
        },
      }),
      null
    );
    assert.equal(
      await resolveDefaultBrowser({
        platform: 'sunos',
        runCommand: async () => '',
      }),
      null
    );
  });

  it('parses handler blocks and ProgId lines directly', () => {
    assert.equal(
      parseMacLaunchServicesHandler(
        '{ LSHandlerURLScheme = https; LSHandlerRoleAll = "com.brave.browser"; }'
      ),
      'com.brave.browser'
    );
    assert.equal(
      parseWindowsProgId('  ProgId   REG_SZ   FirefoxHTML'),
      'FirefoxHTML'
    );
    assert.equal(browserForIdentifier('COM.GOOGLE.CHROME', 'darwin'), 'chrome');
    assert.equal(browserForIdentifier('', 'darwin'), null);
  });
});

it('uses the modern macOS URL handler when LSHandlers is empty', async () => {
  assert.equal(
    await resolveDefaultBrowser({
      platform: 'darwin',
      runCommand: async (command) =>
        command === 'osascript' ? 'com.google.chrome\n' : '()',
    }),
    'chrome'
  );
  assert.equal(
    await resolveDefaultBrowser({
      platform: 'darwin',
      runCommand: async () => '',
    }),
    null
  );
});
