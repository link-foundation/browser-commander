import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  cacheLocations,
  cachedChromeForTesting,
  chromeForTestingCandidates,
} from '../../../src/browser/chrome-for-testing-cache.js';
import { isChromeForTesting } from '../../../src/browser/launch-executable.js';

const home = await mkdtemp(path.join(tmpdir(), 'browser-commander-cache-'));
after(() => rm(home, { recursive: true, force: true }));

async function install(...segments) {
  const file = path.join(home, ...segments);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '#!/bin/sh\n');
  await chmod(file, 0o755);
  return file;
}

const linux = (env = {}) =>
  cacheLocations({ platform: 'linux', arch: 'x64', home, env });

describe('Chrome for Testing in the download caches (issue #179)', () => {
  it('lists the Playwright builds newest revision first', async () => {
    const old = await install(
      '.cache/ms-playwright/chromium-999/chrome-linux64/chrome'
    );
    const recent = await install(
      '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'
    );
    await mkdir(
      path.join(home, '.cache/ms-playwright/chromium_headless_shell-1300'),
      {
        recursive: true,
      }
    );
    assert.deepEqual(chromeForTestingCandidates('playwright', linux()), [
      recent,
      old,
    ]);
  });

  it('follows PLAYWRIGHT_BROWSERS_PATH and XDG_CACHE_HOME', async () => {
    const moved = await install('moved/chromium-1300/chrome-linux64/chrome');
    assert.deepEqual(
      chromeForTestingCandidates(
        'playwright',
        linux({ PLAYWRIGHT_BROWSERS_PATH: path.join(home, 'moved') })
      ),
      [moved]
    );
    assert.deepEqual(
      chromeForTestingCandidates(
        'playwright',
        linux({ PLAYWRIGHT_BROWSERS_PATH: '0' })
      ),
      []
    );
    const xdg = await install(
      'xdg/ms-playwright/chromium-1/chrome-linux64/chrome'
    );
    assert.deepEqual(
      chromeForTestingCandidates(
        'playwright',
        linux({ XDG_CACHE_HOME: path.join(home, 'xdg') })
      ),
      [xdg]
    );
  });

  it('compares Puppeteer and Selenium versions numerically', async () => {
    const newer = await install(
      '.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome'
    );
    const older = await install(
      '.cache/puppeteer/chrome/linux-99.0.1.1/chrome-linux64/chrome'
    );
    assert.deepEqual(chromeForTestingCandidates('puppeteer', linux()), [
      newer,
      older,
    ]);
    const selenium = await install(
      '.cache/selenium/chrome/linux64/131.0.6778.85/chrome'
    );
    assert.deepEqual(chromeForTestingCandidates('selenium', linux()), [
      selenium,
    ]);
    for (const file of [newer, older, selenium]) {
      assert.ok(isChromeForTesting(file), file);
    }
  });

  it('searches the caches each engine uses, in order', () => {
    const machine = { platform: 'linux', arch: 'x64', home, env: {} };
    const cacheOf = (file) =>
      ['ms-playwright', 'puppeteer', 'selenium'].find((cache) =>
        file.split(path.sep).includes(cache)
      );
    const caches = (engine) => [
      ...new Set(cachedChromeForTesting(engine, machine).map(cacheOf)),
    ];
    assert.deepEqual(caches('playwright'), ['ms-playwright']);
    assert.deepEqual(caches('puppeteer'), ['puppeteer']);
    assert.deepEqual(caches('selenium'), [
      'ms-playwright',
      'puppeteer',
      'selenium',
    ]);
  });

  it('knows the macOS and Windows layouts and skips other platforms', () => {
    assert.equal(
      cacheLocations({ platform: 'darwin', arch: 'arm64', home, env: {} }).name,
      'mac-arm64'
    );
    assert.equal(
      cacheLocations({ platform: 'win32', arch: 'ia32', home, env: {} })
        .puppeteer,
      'win32'
    );
    assert.equal(
      cacheLocations({ platform: 'linux', arch: 'arm64', home, env: {} }),
      undefined
    );
    assert.deepEqual(
      cachedChromeForTesting('playwright', {
        platform: 'linux',
        arch: 'arm64',
        home,
        env: {},
      }),
      []
    );
  });
});
