import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  buildPlaywrightLaunchOptions,
  buildPuppeteerLaunchOptions,
  resolveChromeArgs,
} from '../../../src/browser/launch-options.js';
import { CHROME_ARGS } from '../../../src/core/constants.js';

describe('browser launch options', () => {
  it('adds no switches of its own by default (issue #103)', () => {
    const options = resolveChromeArgs();

    assert.deepEqual(options.args, []);
    assert.deepEqual(options.ignoreDefaultArgs, []);
  });

  it('appends custom args after opt-in restrictions', () => {
    const options = resolveChromeArgs({
      restrictions: ['no-sync', 'no-translate'],
      args: ['--legacy-arg', '--disable-features=Foo'],
      extraArgs: ['--lang=en-US'],
    });

    assert.deepEqual(options.args, [
      '--disable-sync',
      // Chrome keeps only the last --disable-features, so they are merged.
      '--disable-features=Translate,Foo',
      '--legacy-arg',
      '--lang=en-US',
    ]);
  });

  it('restores the pre-#103 switches through the legacy-defaults preset', () => {
    const options = resolveChromeArgs({ restrictions: ['legacy-defaults'] });

    assert.deepEqual([...options.args].sort(), [...CHROME_ARGS].sort());
  });

  it('rejects malformed arguments and unknown restrictions', () => {
    assert.throws(() => resolveChromeArgs({ args: '--x' }), TypeError);
    assert.throws(
      () => resolveChromeArgs({ ignoreDefaultArgs: 'yes' }),
      TypeError
    );
    assert.throws(
      () => resolveChromeArgs({ restrictions: ['no-such-thing'] }),
      RangeError
    );
  });

  it('never adds --start-maximized to Puppeteer', () => {
    const options = buildPuppeteerLaunchOptions({
      headless: false,
      chromeArgs: [],
      userDataDir: '/tmp/browser-commander-test',
    });

    assert.equal(options.args.includes('--start-maximized'), false);
  });

  it('forwards ignored defaults to both browser engines', () => {
    const playwright = buildPlaywrightLaunchOptions({
      headless: false,
      slowMo: 0,
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
      slowMo: 0,
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
