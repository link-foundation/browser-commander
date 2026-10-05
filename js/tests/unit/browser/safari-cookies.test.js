// feature-parity: sources.safari-cookies@native-typed
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';

import {
  listCookieSources,
  readBrowserCookiesWithDependencies,
  resolveImportSource,
} from '../../../src/browser/browser-cookies.js';
import { listBrowserProfiles } from '../../../src/browser/browser-profiles.js';
import { migrateProfile } from '../../../src/browser/migration/index.js';
import { runCli } from '../../../src/cli/main.js';
import { runScript } from '../../../src/cli/script.js';
import {
  findSafariCookieFile,
  parseSafariCookies,
  readSafariCookieFile,
} from '../../../src/browser/safari-cookies.js';
import { repoPath } from '../../helpers/repo.js';
import { useTempDirectories } from '../../helpers/temp-directory.js';

const fixture = await readFile(
  repoPath('tests/fixtures/safari/Cookies.binarycookies')
);
const expected = JSON.parse(
  await readFile(repoPath('tests/fixtures/safari/expected.json'), 'utf8')
);
const makeDirectory = useTempDirectories();
const safariDefault = async () =>
  '( { LSHandlerURLScheme = https; LSHandlerRoleAll = "com.apple.Safari"; } )';

async function installed(browser = 'safari', legacy = false) {
  const homeDir = await makeDirectory('bc-safari-');
  const bundle =
    browser === 'safari'
      ? 'com.apple.Safari'
      : 'com.apple.SafariTechnologyPreview';
  const root = legacy
    ? path.join(homeDir, 'Library')
    : path.join(homeDir, 'Library', 'Containers', bundle, 'Data', 'Library');
  await mkdir(path.join(root, 'Cookies'), { recursive: true });
  const file = path.join(root, 'Cookies', 'Cookies.binarycookies');
  await copyFile(repoPath('tests/fixtures/safari/Cookies.binarycookies'), file);
  return { homeDir, root, file, platform: 'darwin', environment: {} };
}

describe('Safari cookies', { timeout: 10000 }, () => {
  it('decodes multiple pages, flags, UTF-8 and Apple epoch without guessing session cookies', () => {
    assert.deepEqual(parseSafariCookies(fixture), expected);
  });

  it('rejects truncated data and forged counts, record sizes, offsets, strings and expiry', () => {
    // The last eight bytes are an optional footer; every shorter prefix is invalid.
    for (let end = 0; end < fixture.length - 8; end += 1) {
      assert.throws(
        () => parseSafariCookies(fixture.subarray(0, end)),
        /Invalid Safari binarycookies/
      );
    }
    for (const [offset, value] of [
      [4, 0xffffffff],
      [24, 0xffffffff],
      [28, 0xffffffff],
      [40, 0xffffffff],
      [56, 0],
    ]) {
      const broken = Buffer.from(fixture);
      broken.writeUInt32LE(value, offset);
      assert.throws(
        () => parseSafariCookies(broken),
        /Invalid Safari binarycookies/
      );
    }
    const broken = Buffer.from(fixture);
    broken.writeDoubleLE(NaN, 80);
    assert.throws(
      () => parseSafariCookies(broken),
      /Invalid Safari binarycookies/
    );
  });

  it('reads both Safari variants and the legacy path without a keystore', async () => {
    for (const [browser, legacy] of [
      ['safari', false],
      ['safari-technology-preview', false],
      ['safari', true],
    ]) {
      const options = await installed(browser, legacy);
      const before = await readFile(options.file);
      const profiles = await listBrowserProfiles({ ...options, browser });
      assert.equal(profiles[0].path, options.root);
      const cookies = await readBrowserCookiesWithDependencies(
        { browser, cache: false },
        options
      );
      assert.deepEqual(cookies, expected);
      assert.deepEqual(await readFile(options.file), before);
    }
  });

  it('lists counts without decoding cookie values and supports default domain import', async () => {
    const options = await installed();
    const damagedValue = Buffer.from(fixture);
    damagedValue[40 + damagedValue.readUInt32LE(68)] = 0xff;
    await writeFile(options.file, damagedValue);
    const sources = await listCookieSources({
      ...options,
      domains: ['GITHUB.COM'],
    });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].cookies, 4);
    assert.deepEqual(sources[0].byDomain, { 'GITHUB.COM': 2 });
    assert.ok(!JSON.stringify(sources).includes('fixture-token'));
    await writeFile(options.file, fixture);
    const source = await resolveImportSource({
      ...options,
      browser: 'default',
      domains: ['github.com'],
      runCommand: safariDefault,
    });
    assert.equal(source.browser, 'safari');
    assert.equal(source.warning, null);
    const report = await migrateProfile({
      ...options,
      from: { browser: 'auto' },
      to: path.join(options.homeDir, 'target'),
      domains: ['github.com', 'GITHUB.COM'],
      runCommand: safariDefault,
    });
    assert.deepEqual(report.cookies, expected.slice(0, 2));
    assert.equal(report.migrated.cookies, 2);
    assert.equal(report.skipped.length, 5);
    assert.equal(
      report.skipped.find((entry) => entry.type === 'passwords').reason,
      'safari-password-export-required'
    );
    assert.ok(
      report.warnings.some(
        (entry) => entry.reason === 'safari-samesite-unavailable'
      )
    );
  });

  it('reads an explicit source directory and reports actionable Full Disk Access errors', async () => {
    const options = await installed();
    const cookies = await readBrowserCookiesWithDependencies(
      {
        browser: 'safari',
        profileDir: options.root,
        domainFilter: 'github.com',
        cache: false,
      },
      { homeDir: path.join(options.homeDir, 'empty') }
    );
    assert.deepEqual(cookies, expected.slice(0, 2));
    const error = Object.assign(new Error('Operation not permitted'), {
      code: 'EPERM',
    });
    assert.ok(
      await findSafariCookieFile(options.root, async () => {
        throw error;
      })
    );
    await assert.rejects(
      readSafariCookieFile(options.file, {
        environment: { TERM_PROGRAM: 'TestTerminal' },
        readFile: async () => {
          throw error;
        },
      }),
      /Full Disk Access.*TestTerminal.*x-apple.systempreferences:com.apple.preference.security\?Privacy_AllFiles/
    );
  });

  it('preserves unreadable source errors instead of silently treating the default as empty', async () => {
    const options = await installed();
    await writeFile(options.file, Buffer.from('corrupt'));
    const sources = await listCookieSources({
      ...options,
      domains: ['github.com'],
    });
    assert.match(sources[0].error, /Invalid Safari binarycookies/);
    await assert.rejects(
      resolveImportSource({
        ...options,
        browser: 'default',
        domains: ['github.com'],
        runCommand: safariDefault,
      }),
      /Could not inspect the default browser.*Invalid Safari binarycookies/
    );
  });

  it('imports through the CLI and command-stream dispatcher using the real reader', async () => {
    const options = await installed();
    const to = path.join(options.homeDir, 'target');
    const output = new PassThrough();
    const chunks = [];
    output.on('data', (chunk) => chunks.push(chunk.toString()));
    const exitCode = await runCli(
      [
        'profile',
        'migrate',
        '--from',
        'safari',
        '--user-data-dir',
        options.root,
        '--include',
        'cookies',
        '--domain',
        'github.com',
        '--to',
        to,
      ],
      {
        stdout: output,
        stdin: new PassThrough(),
        signals: new EventEmitter(),
      }
    );
    const report = JSON.parse(chunks.join(''));
    assert.equal(exitCode, 0, JSON.stringify(report));
    assert.deepEqual(report.cookies, expected.slice(0, 2));
    const script = await runScript({
      steps: [
        {
          method: 'profile.migrate',
          params: {
            from: 'safari',
            userDataDir: options.root,
            to,
            include: ['cookies'],
            domains: ['github.com'],
          },
        },
      ],
    });
    assert.equal(script.failed, false, JSON.stringify(script));
    assert.deepEqual(script.results[0].result.cookies, expected.slice(0, 2));
    assert.deepEqual(await readFile(options.file), fixture);
  });
});
