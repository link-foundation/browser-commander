// feature-parity: launch.chrome-for-testing@native-typed
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHROME_FOR_TESTING_RESTRICTIONS,
  defaultRestrictionsFor,
  isChromeForTesting,
} from '../../../src/browser/launch-executable.js';
import { resolveRestrictions } from '../../../src/browser/restrictions.js';
import * as api from '../../../src/index.js';

describe('isChromeForTesting (issue #179)', () => {
  it('recognises the Chrome for Testing install layouts', () => {
    for (const executable of [
      // Playwright
      '/home/u/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
      '/Users/u/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'C:\\Users\\u\\AppData\\Local\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe',
      // Puppeteer and @puppeteer/browsers
      '/home/u/.cache/puppeteer/chrome/linux-131.0.6778.85/chrome-linux64/chrome',
      '/Users/u/.cache/puppeteer/chrome/mac_arm-131.0.6778.85/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'C:\\Users\\u\\.cache\\puppeteer\\chrome\\win32-131.0.6778.85\\chrome-win32\\chrome.exe',
      '/Users/u/Library/Caches/ms-playwright/chromium-1248/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      // Selenium Manager
      '/home/u/.cache/selenium/chrome/linux64/131.0.6778.85/chrome',
      'C:\\Users\\u\\.cache\\selenium\\chrome\\win64\\131.0.6778.85\\chrome.exe',
      // An app copied anywhere keeps its name
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ]) {
      assert.equal(isChromeForTesting(executable), true, executable);
    }
  });

  it('leaves every other browser alone', () => {
    for (const executable of [
      undefined,
      '',
      '/usr/bin/google-chrome',
      '/opt/google/chrome/chrome',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      '/usr/bin/chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      // Playwright's own Chromium builds before Chrome for Testing
      '/home/u/.cache/ms-playwright/chromium-1100/chrome-linux/chrome',
      '/Users/u/Library/Caches/ms-playwright/chromium-1100/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
      // Selenium Manager's Firefox cache
      '/home/u/.cache/selenium/firefox/linux64/133.0/firefox',
    ]) {
      assert.equal(isChromeForTesting(executable), false, String(executable));
    }
  });
});

describe('defaultRestrictionsFor (issue #179)', () => {
  const cft =
    '/home/u/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';

  it('gives Chrome for Testing the chrome-for-testing preset', () => {
    assert.deepEqual(defaultRestrictionsFor(cft), [
      'no-chrome-for-testing-infobar',
      'mock-keychain',
    ]);
    assert.deepEqual(defaultRestrictionsFor('/usr/bin/google-chrome'), []);
  });

  it("uses the caller's defaultRestrictions as given", () => {
    assert.deepEqual(defaultRestrictionsFor(cft, []), []);
    assert.deepEqual(
      defaultRestrictionsFor('/usr/bin/google-chrome', ['mock-keychain']),
      ['mock-keychain']
    );
    // The preset itself is never handed out to be mutated.
    defaultRestrictionsFor(cft).push('no-sync');
    assert.deepEqual(CHROME_FOR_TESTING_RESTRICTIONS, [
      'no-chrome-for-testing-infobar',
      'mock-keychain',
    ]);
  });

  it('hides the infobar with --test-type=gpu and skips the keychain prompt', () => {
    assert.deepEqual(resolveRestrictions(['chrome-for-testing']).args, [
      '--test-type=gpu',
      '--use-mock-keychain',
    ]);
    assert.deepEqual(api.LAUNCH_RESTRICTION_PRESETS['chrome-for-testing'], [
      'no-chrome-for-testing-infobar',
      'mock-keychain',
    ]);
    assert.equal(api.isChromeForTesting, isChromeForTesting);
  });
});
