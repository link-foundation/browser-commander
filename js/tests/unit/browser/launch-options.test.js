import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  buildPlaywrightLaunchOptions,
  buildPuppeteerLaunchOptions,
  resolveChromeArgs,
} from '../../../src/browser/launch-options.js';

describe('browser launch options', () => {
  it('applies safe defaults, appends extra arguments, and supports per-flag opt-out', () => {
    const options = resolveChromeArgs({
      args: ['--legacy-arg'],
      extraArgs: ['--lang=en-US'],
      ignoreDefaultArgs: ['--no-default-browser-check'],
    });

    assert.ok(options.args.includes('--password-store=basic'));
    assert.ok(options.args.includes('--no-first-run'));
    assert.equal(options.args.includes('--no-default-browser-check'), false);
    assert.deepEqual(options.args.slice(-2), ['--legacy-arg', '--lang=en-US']);
    assert.deepEqual(options.ignoreDefaultArgs, ['--no-default-browser-check']);
  });

  it('can ignore every Browser Commander default', () => {
    const options = resolveChromeArgs({
      extraArgs: ['--lang=en-US'],
      ignoreDefaultArgs: true,
    });

    assert.deepEqual(options.args, ['--lang=en-US']);
    assert.equal(options.ignoreDefaultArgs, true);
  });

  it('can opt out of the password-store default specifically', () => {
    const options = resolveChromeArgs({
      ignoreDefaultArgs: ['--password-store=basic'],
    });

    assert.equal(options.args.includes('--password-store=basic'), false);
    assert.ok(options.args.includes('--no-first-run'));
  });

  it('forwards ignored defaults to both browser engines', () => {
    const playwright = buildPlaywrightLaunchOptions({
      headless: false,
      slowMo: 150,
      chromeArgs: [],
      ignoreDefaultArgs: ['--no-first-run'],
    });
    const puppeteer = buildPuppeteerLaunchOptions({
      headless: false,
      chromeArgs: [],
      userDataDir: '/tmp/browser-commander-test',
      ignoreDefaultArgs: ['--no-first-run'],
    });

    assert.deepEqual(playwright.ignoreDefaultArgs, [
      '--enable-automation',
      // Playwright also forces software WebGL on, which a hand-started Chrome
      // without a usable GPU refuses to do.
      '--enable-unsafe-swiftshader',
      '--no-first-run',
    ]);
    // Puppeteer passes --enable-automation by default, so automation parity
    // has to suppress it there too.
    assert.deepEqual(puppeteer.ignoreDefaultArgs, [
      '--enable-automation',
      '--no-first-run',
    ]);
  });

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
