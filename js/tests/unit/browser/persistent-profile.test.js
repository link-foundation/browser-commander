// feature-parity: profile.session-cookies@native-typed
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  KEEP_SESSION_COOKIES_SWITCH,
  SESSION_RESTORE_FILES,
  clearRestoredTabs,
  persistentProfileArgs,
} from '../../../src/index.js';
import {
  FRESH_PROFILE,
  prepareSessionRestore,
  profileDirectoryFromArgs,
  resolveKeepSessionCookies,
} from '../../../src/browser/persistent-profile.js';
import {
  buildRealBrowserArgs,
  launchAndConnectRealBrowserWithDependencies,
} from '../../../src/browser/real-browser.js';
import { launchBrowserWithDependencies } from '../../../src/browser/launcher.js';
import { launchParams, parseCommandLine } from '../../../src/cli/args.js';

const exists = (file) =>
  access(file).then(
    () => true,
    () => false
  );

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

// A profile directory that was used before: cookies plus the last session.
async function usedProfile(profileDirectory = 'Default') {
  const userDataDir = await mkdtemp(
    path.join(tmpdir(), 'browser-commander-issue-187-')
  );
  directories.push(userDataDir);
  const profile = path.join(userDataDir, profileDirectory);
  await mkdir(path.join(profile, 'Sessions'), { recursive: true });
  await writeFile(path.join(profile, 'Sessions', 'Session_1'), 'tabs');
  await writeFile(path.join(profile, 'Current Tabs'), 'tabs');
  await writeFile(path.join(profile, 'Cookies'), 'cookies');
  return { userDataDir, profile };
}

describe('persistentProfileArgs (issue #187)', () => {
  it('keeps session cookies with --restore-last-session by default', () => {
    assert.equal(KEEP_SESSION_COOKIES_SWITCH, '--restore-last-session');
    assert.deepEqual(persistentProfileArgs(), ['--restore-last-session']);
    assert.deepEqual(persistentProfileArgs({ keepSessionCookies: true }), [
      '--restore-last-session',
    ]);
  });

  it('turns the continue-session default off for the opt-out', () => {
    assert.deepEqual(persistentProfileArgs({ keepSessionCookies: false }), [
      '--disable-features=SessionRestoreInfobar',
    ]);
  });

  it('refuses a non-boolean choice', () => {
    assert.throws(
      () => persistentProfileArgs({ keepSessionCookies: 'yes' }),
      /keepSessionCookies must be a boolean/
    );
  });
});

describe('resolveKeepSessionCookies', () => {
  it('keeps them for a persistent profile and leaves a temporary one alone', () => {
    assert.equal(resolveKeepSessionCookies({ temporaryProfile: false }), true);
    assert.equal(
      resolveKeepSessionCookies({ temporaryProfile: true }),
      undefined
    );
    assert.equal(
      resolveKeepSessionCookies({
        temporaryProfile: false,
        [FRESH_PROFILE]: true,
      }),
      undefined
    );
  });

  it('follows an explicit choice either way', () => {
    for (const temporaryProfile of [true, false]) {
      for (const keepSessionCookies of [true, false]) {
        assert.equal(
          resolveKeepSessionCookies({ keepSessionCookies, temporaryProfile }),
          keepSessionCookies
        );
      }
    }
  });
});

describe('clearRestoredTabs', () => {
  it('deletes the last session and keeps the cookie store', async () => {
    const { userDataDir, profile } = await usedProfile();
    await clearRestoredTabs(userDataDir);
    for (const name of SESSION_RESTORE_FILES) {
      assert.equal(await exists(path.join(profile, name)), false, name);
    }
    assert.equal(await exists(path.join(profile, 'Cookies')), true);
  });

  it('follows --profile-directory and refuses paths', async () => {
    assert.equal(profileDirectoryFromArgs([]), 'Default');
    assert.equal(
      profileDirectoryFromArgs([
        '--profile-directory=Profile 1',
        '--profile-directory=Profile 2',
      ]),
      'Profile 2'
    );
    const { userDataDir, profile } = await usedProfile('Profile 2');
    await prepareSessionRestore(userDataDir, {
      keepSessionCookies: true,
      args: ['--profile-directory=Profile 2'],
    });
    assert.equal(await exists(path.join(profile, 'Sessions')), false);
    await assert.rejects(
      clearRestoredTabs(userDataDir, { profileDirectory: '../outside' }),
      /one profile directory name/
    );
  });

  it('is skipped with restoreTabs or without keeping cookies', async () => {
    const { userDataDir, profile } = await usedProfile();
    for (const options of [
      { keepSessionCookies: true, restoreTabs: true },
      { keepSessionCookies: false },
      { keepSessionCookies: undefined },
    ]) {
      await prepareSessionRestore(userDataDir, options);
      assert.equal(await exists(path.join(profile, 'Sessions')), true);
    }
  });
});

describe('buildRealBrowserArgs keepSessionCookies', () => {
  const base = { userDataDir: '/p', remoteDebuggingPort: 9222 };

  it('adds the switch before custom args, once', () => {
    assert.deepEqual(
      buildRealBrowserArgs({ ...base, keepSessionCookies: true }),
      [
        '--user-data-dir=/p',
        '--remote-debugging-port=9222',
        '--restore-last-session',
        'about:blank',
      ]
    );
    const custom = buildRealBrowserArgs({
      ...base,
      keepSessionCookies: true,
      args: ['--restore-last-session'],
    });
    assert.equal(
      custom.filter((argument) => argument === '--restore-last-session').length,
      1
    );
  });

  it('merges the opt-out with restriction features', () => {
    const args = buildRealBrowserArgs({
      ...base,
      keepSessionCookies: false,
      disableFeatures: ['Translate'],
    });
    assert.equal(args.includes('--restore-last-session'), false);
    assert.deepEqual(
      args.filter((argument) => argument.startsWith('--disable-features=')),
      ['--disable-features=Translate,SessionRestoreInfobar']
    );
  });

  it('adds nothing when unset', () => {
    assert.deepEqual(buildRealBrowserArgs(base), [
      '--user-data-dir=/p',
      '--remote-debugging-port=9222',
      'about:blank',
    ]);
  });
});

// launchAndConnectRealBrowser with a recorded spawn and a fake connection.
async function realLaunch(options) {
  const spawned = [];
  const browserProcess = {
    exitCode: null,
    killed: false,
    kill() {
      this.killed = true;
    },
    exited: Promise.resolve(0),
  };
  const result = await launchAndConnectRealBrowserWithDependencies(
    { engine: 'puppeteer', channel: 'chrome', ...options },
    {
      resolveExecutable: async () => '/opt/google/chrome',
      reservePort: async () => 9555,
      spawnBrowser: (executablePath, args) => {
        spawned.push(args);
        return browserProcess;
      },
      waitForEndpoint: async () => 'http://127.0.0.1:9555',
      connect: async () => ({
        browser: { close: async () => {} },
        page: { id: 'page' },
      }),
    }
  );
  return { result, args: spawned[0] };
}

describe('launchRealBrowser keepSessionCookies', () => {
  it('keeps session cookies of a persistent profile and starts with one tab', async () => {
    const { userDataDir, profile } = await usedProfile();
    const { result, args } = await realLaunch({ userDataDir });
    assert.ok(args.includes('--restore-last-session'));
    assert.equal(result.keepSessionCookies, true);
    assert.deepEqual(result.warnings, []);
    assert.equal(await exists(path.join(profile, 'Sessions')), false);
    assert.equal(await exists(path.join(profile, 'Cookies')), true);
  });

  it('keeps the last tabs with restoreTabs', async () => {
    const { userDataDir, profile } = await usedProfile();
    const { args } = await realLaunch({ userDataDir, restoreTabs: true });
    assert.ok(args.includes('--restore-last-session'));
    assert.equal(await exists(path.join(profile, 'Sessions')), true);
  });

  it('lets Chromium delete them with keepSessionCookies: false', async () => {
    const { userDataDir, profile } = await usedProfile();
    const { result, args } = await realLaunch({
      userDataDir,
      keepSessionCookies: false,
    });
    assert.equal(args.includes('--restore-last-session'), false);
    assert.ok(args.includes('--disable-features=SessionRestoreInfobar'));
    assert.equal(result.keepSessionCookies, false);
    assert.equal(await exists(path.join(profile, 'Sessions')), true);
  });

  it('leaves a temporary profile command line as it was', async () => {
    const { result, args } = await realLaunch({});
    assert.equal(result.temporaryProfile, true);
    assert.equal(result.keepSessionCookies, false);
    assert.equal(
      args.some(
        (argument) =>
          argument === '--restore-last-session' ||
          argument.includes('SessionRestoreInfobar')
      ),
      false
    );
    await result.close();
  });

  it('refuses a non-boolean before anything starts', async () => {
    await assert.rejects(
      realLaunch({ keepSessionCookies: 'no' }),
      /keepSessionCookies must be a boolean/
    );
    await assert.rejects(
      realLaunch({ restoreTabs: 1 }),
      /restoreTabs must be a boolean/
    );
  });
});

describe("launchBrowser({launch: 'engine'}) keepSessionCookies", () => {
  async function engineLaunch(options) {
    const calls = [];
    const page = { bringToFront: async () => {} };
    const playwright = {
      launchPersistentContext: async (userDataDir, launchOptions) => {
        calls.push([userDataDir, launchOptions]);
        return { pages: () => [page], close: async () => {} };
      },
    };
    const result = await launchBrowserWithDependencies(
      { launch: 'engine', ...options },
      { loadEngineModule: async () => playwright, settleMs: 0 }
    );
    await result.close();
    return { result, launchOptions: calls[0][1] };
  }

  it('keeps them for a persistent profile on the full Chromium build when headless', async () => {
    const { userDataDir, profile } = await usedProfile();
    const { result, launchOptions } = await engineLaunch({
      userDataDir,
      headless: true,
    });
    assert.ok(launchOptions.args.includes('--restore-last-session'));
    assert.equal(launchOptions.channel, 'chromium');
    assert.equal(result.keepSessionCookies, true);
    assert.deepEqual(result.warnings, []);
    assert.equal(await exists(path.join(profile, 'Sessions')), false);
  });

  it('warns when an explicit headless shell cannot keep them', async () => {
    const { userDataDir } = await usedProfile();
    const { result } = await engineLaunch({
      userDataDir,
      headless: true,
      channel: 'chromium-headless-shell',
    });
    assert.deepEqual(
      result.warnings.map(({ item, reason }) => [item, reason]),
      [['keepSessionCookies', 'headless-shell']]
    );
  });

  it('changes nothing for a temporary profile or the opt-out', async () => {
    const temporary = await engineLaunch({ headless: true });
    assert.equal(temporary.launchOptions.channel, undefined);
    assert.equal(temporary.result.keepSessionCookies, false);
    assert.equal(
      temporary.launchOptions.args.includes('--restore-last-session'),
      false
    );
    const { userDataDir } = await usedProfile();
    const optOut = await engineLaunch({
      userDataDir,
      headless: true,
      keepSessionCookies: false,
    });
    assert.equal(optOut.launchOptions.channel, undefined);
    assert.ok(
      optOut.launchOptions.args.includes(
        '--disable-features=SessionRestoreInfobar'
      )
    );
  });
});

describe('launchBrowser({keepOpen: true}) keepSessionCookies', () => {
  it('treats the profile it creates as temporary and a given one as persistent', async () => {
    const seen = [];
    const connectOrLaunch = async (options) => {
      if (options[FRESH_PROFILE]) {
        directories.push(options.userDataDir);
      }
      seen.push(
        resolveKeepSessionCookies({ ...options, temporaryProfile: false })
      );
      return { browser: {}, page: {}, close: async () => {} };
    };
    const { userDataDir } = await usedProfile();
    await launchBrowserWithDependencies(
      { keepOpen: true, remoteDebuggingPort: 9556 },
      { connectOrLaunch }
    );
    await launchBrowserWithDependencies(
      { keepOpen: true, userDataDir, remoteDebuggingPort: 9557 },
      { connectOrLaunch }
    );
    assert.deepEqual(seen, [undefined, true]);
  });
});

describe('CLI session cookie flags', () => {
  const params = (...argv) =>
    launchParams(parseCommandLine(['launch', ...argv]).options);

  it('maps --keep-session-cookies, --no-keep-session-cookies and --restore-tabs', () => {
    assert.equal('keepSessionCookies' in params(), false);
    assert.equal(params('--keep-session-cookies').keepSessionCookies, true);
    assert.equal(params('--no-keep-session-cookies').keepSessionCookies, false);
    assert.equal(params('--restore-tabs').restoreTabs, true);
    assert.throws(
      () => params('--keep-session-cookies', '--no-keep-session-cookies'),
      /mutually exclusive/
    );
  });
});
