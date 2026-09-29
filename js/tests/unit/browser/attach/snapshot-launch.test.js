import assert from 'node:assert';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  ATTACH_MODES,
  attachUserBrowser,
  describeAttachDifferences,
  snapshotBrowserForChannel,
  snapshotUserDataDir,
} from '../../../../src/browser/attach/index.js';
import {
  prepareSnapshotLaunch,
  validateAttachOption,
} from '../../../../src/browser/attach/snapshot-launch.js';
import { launchBrowserWithDependencies } from '../../../../src/browser/launcher.js';
import { launchAndConnectRealBrowserWithDependencies } from '../../../../src/browser/real-browser.js';
import * as publicApi from '../../../../src/exports.js';
import { useTempDirectories } from '../../../helpers/temp-directory.js';

const makeTempDir = useTempDirectories('bc-attach-launch-');

/** A snapshot stand-in that creates an empty user data directory. */
function fakeSnapshot(calls, extra = {}) {
  return async (options) => {
    calls.push(options);
    const target = await makeTempDir();
    return {
      source: {
        browser: options.browser,
        profile: options.profile,
        userDataDir: '/home/user/.config/google-chrome',
      },
      target,
      copied: { files: 1, databases: 0 },
      skipped: [],
      warnings: [],
      ...extra,
    };
  };
}

/** Launch seams that never start a process. */
function fakeLaunchDependencies(calls) {
  const exitListeners = [];
  const browserProcess = {
    exitCode: null,
    kill() {
      this.exit(143);
    },
    once: (event, listener) => exitListeners.push(listener),
    exit(code) {
      browserProcess.exitCode = code;
      exitListeners.splice(0).forEach((listener) => listener(code));
    },
  };
  return {
    browserProcess,
    dependencies: {
      resolveExecutable: async () => '/opt/google/chrome',
      reservePort: async () => 9555,
      spawnBrowser: (executablePath, args) => {
        calls.push(['spawn', args]);
        return browserProcess;
      },
      waitForEndpoint: async () => 'http://127.0.0.1:9555',
      connect: async () => ({ browser: { close: async () => {} }, page: {} }),
    },
  };
}

describe('describeAttachDifferences', () => {
  it('lists the documented differences of every mode', () => {
    assert.deepEqual(ATTACH_MODES, ['clean', 'snapshot', 'extension', 'open']);
    const aspects = (mode) =>
      describeAttachDifferences(mode).map(({ aspect }) => aspect);
    assert.ok(aspects('snapshot').includes('not-copied'));
    assert.ok(aspects('snapshot').includes('encrypted-data'));
    assert.ok(aspects('extension').includes('debugger-infobar'));
    assert.ok(aspects('clean').includes('user-data-dir'));
    assert.deepEqual(describeAttachDifferences('open'), []);
    for (const mode of ATTACH_MODES) {
      for (const entry of describeAttachDifferences(mode)) {
        assert.equal(typeof entry.description, 'string');
      }
    }
    // Callers get their own copies.
    describeAttachDifferences('snapshot')[0].aspect = 'changed';
    assert.notEqual(describeAttachDifferences('snapshot')[0].aspect, 'changed');
    assert.throws(() => describeAttachDifferences('remote'), TypeError);
  });

  it('is exported from the package API', () => {
    for (const name of [
      'attachUserBrowser',
      'attachViaExtension',
      'describeAttachDifferences',
      'snapshotUserDataDir',
    ]) {
      assert.equal(typeof publicApi[name], 'function', name);
    }
    assert.equal(publicApi.DEFAULT_RELAY_PORT, 9333);
    assert.equal(publicApi.RELAY_PATH, '/browser-commander');
  });
});

describe('snapshot attach launch option', () => {
  it('maps channels to the browser whose profile is copied', () => {
    assert.equal(snapshotBrowserForChannel('chrome'), 'chrome');
    assert.equal(snapshotBrowserForChannel('chrome-beta'), 'chrome');
    assert.equal(snapshotBrowserForChannel('msedge-dev'), 'edge');
    assert.equal(snapshotBrowserForChannel('brave'), 'brave');
    assert.equal(snapshotBrowserForChannel('chromium'), 'chromium');
  });

  it('rejects attach with userDataDir, migrateFrom, other modes and --profile-directory', () => {
    const attach = { mode: 'snapshot' };
    validateAttachOption({ attach });
    validateAttachOption({ attach: undefined, userDataDir: '/tmp/x' });
    for (const options of [
      { attach, userDataDir: '/tmp/x' },
      { attach, migrateFrom: { browser: 'chrome' } },
      { attach: { mode: 'extension' } },
      { attach: 'snapshot' },
      { attach, customArgs: ['--profile-directory=Profile 1'] },
    ]) {
      assert.throws(() => validateAttachOption(options), TypeError);
    }
  });

  it('rejects attach and userDataDir before anything touches the disk', async () => {
    const calls = [];
    const { dependencies } = fakeLaunchDependencies(calls);
    for (const options of [
      { attach: { mode: 'snapshot' }, userDataDir: '/tmp/dedicated' },
      { attach: { mode: 'snapshot' }, migrateFrom: { browser: 'chrome' } },
      { attach: { mode: 'open' } },
    ]) {
      await assert.rejects(
        launchAndConnectRealBrowserWithDependencies(options, {
          ...dependencies,
          snapshotUserDataDir: fakeSnapshot(calls),
        }),
        TypeError
      );
    }
    assert.deepEqual(calls, []);
    await assert.rejects(
      launchBrowserWithDependencies({
        launch: 'engine',
        attach: { mode: 'snapshot' },
      }),
      /attach needs launch: 'real'/u
    );
  });

  it('launches on the snapshot with --profile-directory and deletes it on exit', async () => {
    const calls = [];
    const snapshots = [];
    const { browserProcess, dependencies } = fakeLaunchDependencies(calls);

    const result = await launchAndConnectRealBrowserWithDependencies(
      {
        engine: 'puppeteer',
        channel: 'msedge',
        attach: { mode: 'snapshot', profile: 'Profile 1' },
        args: ['--lang=en-US'],
      },
      { ...dependencies, snapshotUserDataDir: fakeSnapshot(snapshots) }
    );

    assert.deepEqual(snapshots, [
      { browser: 'edge', profile: 'Profile 1', userDataDir: undefined },
    ]);
    assert.equal(result.temporaryProfile, true);
    assert.equal(result.userDataDir, result.attach.snapshot.target);
    assert.equal(result.attach.mode, 'snapshot');
    assert.deepEqual(
      result.attach.differences,
      describeAttachDifferences('snapshot')
    );
    assert.deepEqual(calls[0], [
      'spawn',
      [
        `--user-data-dir=${result.userDataDir}`,
        '--remote-debugging-port=9555',
        '--profile-directory=Profile 1',
        '--lang=en-US',
        'about:blank',
      ],
    ]);

    await access(result.userDataDir);
    browserProcess.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(access(result.userDataDir), { code: 'ENOENT' });
  });

  it('warns when the keystore is bypassed or the browsers differ', async () => {
    const calls = [];
    const launch = await prepareSnapshotLaunch({
      attach: { mode: 'snapshot', browser: 'chrome' },
      channel: 'brave',
      restrictions: [],
      customArgs: [
        '--use-mock-keychain',
        '--password-store=basic',
        '--password-store=detect',
      ],
      snapshot: fakeSnapshot(calls, {
        warnings: [{ item: 'Local State', reason: 'local-state-missing' }],
      }),
    });

    assert.deepEqual(launch.args, []);
    assert.deepEqual(
      launch.attach.snapshot.warnings.map(({ item, reason }) => [item, reason]),
      [
        ['Local State', 'local-state-missing'],
        ['--use-mock-keychain', 'encrypted-data-unreadable'],
        ['--password-store=basic', 'encrypted-data-unreadable'],
        ['brave', 'browser-mismatch'],
      ]
    );
    assert.equal(calls[0].profile, 'Default');
  });
});

describe('attachUserBrowser', () => {
  it('dispatches each mode to its implementation', async () => {
    const seen = [];
    const dependencies = {
      launchRealBrowser: async (options) => {
        seen.push(['launch', options]);
        return { page: 'page', attach: { mode: 'snapshot' } };
      },
      attachViaExtension: async (options) => {
        seen.push(['extension', options]);
        return { mode: 'extension' };
      },
      openInUserBrowser: async (url, options) => {
        seen.push(['open', url, options]);
        return { opened: url, command: ['xdg-open', url] };
      },
    };

    const snapshot = await attachUserBrowser(
      { mode: 'snapshot', browser: 'chrome', profile: 'P', headless: true },
      dependencies
    );
    assert.equal(snapshot.page, 'page');
    assert.equal(snapshot.mode, 'snapshot');
    assert.ok(snapshot.differences.length > 0);
    assert.deepEqual(
      await attachUserBrowser({ mode: 'extension', port: 1 }, dependencies),
      { mode: 'extension' }
    );
    assert.deepEqual(
      await attachUserBrowser(
        { mode: 'open', url: 'https://a.test/' },
        dependencies
      ),
      {
        mode: 'open',
        opened: 'https://a.test/',
        command: ['xdg-open', 'https://a.test/'],
        differences: [],
      }
    );
    assert.deepEqual(seen, [
      [
        'launch',
        {
          headless: true,
          attach: {
            mode: 'snapshot',
            browser: 'chrome',
            profile: 'P',
            userDataDir: undefined,
          },
        },
      ],
      ['extension', { port: 1 }],
      ['open', 'https://a.test/', {}],
    ]);
    await assert.rejects(
      attachUserBrowser({ mode: 'open' }, dependencies),
      TypeError
    );
    await assert.rejects(attachUserBrowser({ mode: 'clean' }), TypeError);
  });

  it('prepares a launch from a real snapshot of a directory', async () => {
    const root = await makeTempDir();
    await mkdir(path.join(root, 'Default'));
    await writeFile(path.join(root, 'Default', 'Preferences'), '{}');
    const to = path.join(await makeTempDir(), 'copy');

    const launch = await prepareSnapshotLaunch({
      attach: { mode: 'snapshot', userDataDir: root },
      channel: 'chrome',
      restrictions: [],
      customArgs: [],
      snapshot: (options) => snapshotUserDataDir({ ...options, to }),
    });

    assert.equal(launch.userDataDir, to);
    assert.equal(launch.attach.snapshot.source.userDataDir, root);
    await access(path.join(to, 'Default', 'Preferences'));
  });
});
