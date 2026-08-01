import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  buildPlaywrightLaunchOptions,
  buildPuppeteerLaunchOptions,
} from '../../../src/browser/launch-options.js';

describe('browser launch options', () => {
  it('forwards channel and executablePath to Playwright', () => {
    const options = buildPlaywrightLaunchOptions({
      headless: true,
      slowMo: 25,
      chromeArgs: ['--custom'],
      channel: 'chrome-beta',
      executablePath: '/opt/google/chrome-beta',
    });

    assert.equal(options.channel, 'chrome-beta');
    assert.equal(options.executablePath, '/opt/google/chrome-beta');
  });

  it('forwards channel and executablePath to Puppeteer', () => {
    const options = buildPuppeteerLaunchOptions({
      headless: true,
      chromeArgs: ['--custom'],
      userDataDir: '/tmp/browser-commander-test',
      channel: 'chrome',
      executablePath: '/usr/bin/google-chrome',
    });

    assert.equal(options.channel, 'chrome');
    assert.equal(options.executablePath, '/usr/bin/google-chrome');
  });

  it('omits browser selection options by default', () => {
    const playwright = buildPlaywrightLaunchOptions({
      headless: false,
      slowMo: 150,
      chromeArgs: [],
    });
    const puppeteer = buildPuppeteerLaunchOptions({
      headless: false,
      chromeArgs: [],
      userDataDir: '/tmp/browser-commander-test',
    });

    assert.equal('channel' in playwright, false);
    assert.equal('executablePath' in playwright, false);
    assert.equal('channel' in puppeteer, false);
    assert.equal('executablePath' in puppeteer, false);
  });
});
