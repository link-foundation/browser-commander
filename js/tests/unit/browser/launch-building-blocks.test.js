import { describe, it } from 'node:test';
import assert from 'node:assert';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  LAUNCH_RESTRICTIONS,
  LAUNCH_RESTRICTION_PRESETS,
  mergeFeatureSwitches,
  resolveRestrictions,
} from '../../../src/browser/restrictions.js';
import {
  FIRST_RUN_SENTINEL,
  INITIAL_LOCAL_STATE,
  LOCAL_STATE_FILE,
  TEMPORARY_PROFILE_PREFIX,
  createTemporaryUserDataDir,
  prepareUserDataDir,
  removeUserDataDir,
} from '../../../src/browser/profile-directory.js';
import {
  PortRaceError,
  assertFixedDebuggingPort,
  classifyDevToolsOwnership,
  parseDevToolsOutput,
  reserveLoopbackPort,
  watchDevToolsOutput,
} from '../../../src/browser/debugging-port.js';
import { CHROME_ARGS } from '../../../src/core/constants.js';
import { detectAutomationControlledTriggers } from '../../../src/fingerprint/automation-parity.js';

describe('launch restrictions', () => {
  it('has unique ids and a description for each entry', () => {
    const ids = LAUNCH_RESTRICTIONS.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const entry of LAUNCH_RESTRICTIONS) {
      assert.ok(entry.description.length > 10, entry.id);
      assert.ok(entry.args || entry.disableFeatures || entry.env, entry.id);
    }
  });

  it('never offers a switch that turns AutomationControlled on', () => {
    for (const entry of LAUNCH_RESTRICTIONS) {
      assert.deepEqual(
        detectAutomationControlledTriggers(entry.args ?? []),
        [],
        entry.id
      );
    }
  });

  it('keeps the pre-#103 defaults available as a preset', () => {
    const { args } = resolveRestrictions(['legacy-defaults']);
    assert.deepEqual([...args].sort(), [...CHROME_ARGS].sort());
  });

  it('adds the Google key override only to the browser environment', () => {
    const resolved = resolveRestrictions(['legacy-launch-browser']);
    assert.deepEqual(resolved.env, {
      GOOGLE_API_KEY: 'no',
      GOOGLE_DEFAULT_CLIENT_ID: 'no',
      GOOGLE_DEFAULT_CLIENT_SECRET: 'no',
    });
    assert.ok(resolved.args.includes('--disable-features=Translate'));
    assert.ok(LAUNCH_RESTRICTION_PRESETS['legacy-launch-browser']);
  });

  it('deduplicates ids and joins feature lists into one switch', () => {
    const resolved = resolveRestrictions([
      'no-translate',
      'no-lens',
      'no-translate',
    ]);
    assert.deepEqual(resolved.ids, ['no-translate', 'no-lens']);
    assert.deepEqual(resolved.args, [
      '--disable-features=Translate,LensOverlay',
    ]);
  });

  it('rejects unknown names and non-arrays', () => {
    assert.throws(() => resolveRestrictions(['nope']), RangeError);
    assert.throws(() => resolveRestrictions('no-sync'), TypeError);
  });

  it('merges repeated feature switches into the first position', () => {
    assert.deepEqual(
      mergeFeatureSwitches([
        '--a',
        '--disable-features=A,B',
        '--enable-features=X',
        '--disable-features=B,C',
        '--b',
      ]),
      ['--a', '--disable-features=A,B,C', '--enable-features=X', '--b']
    );
  });
});

describe('profile directory', () => {
  it('creates a fresh profile with the First Run sentinel', async () => {
    const dir = await createTemporaryUserDataDir();
    try {
      assert.ok(path.basename(dir).startsWith(TEMPORARY_PROFILE_PREFIX));
      await access(path.join(dir, FIRST_RUN_SENTINEL));
      assert.deepEqual(
        JSON.parse(await readFile(path.join(dir, LOCAL_STATE_FILE), 'utf8')),
        INITIAL_LOCAL_STATE
      );
    } finally {
      await removeUserDataDir(dir);
    }
    await assert.rejects(() => access(dir), /ENOENT/);
  });

  it('never overwrites Local State that Chrome already wrote', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-profile-test-'));
    try {
      const localState = path.join(dir, LOCAL_STATE_FILE);
      await writeFile(
        localState,
        '{"browser":{"enabled_labs_experiments":[]}}'
      );
      await prepareUserDataDir(dir);
      assert.equal(
        await readFile(localState, 'utf8'),
        '{"browser":{"enabled_labs_experiments":[]}}'
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps an existing sentinel untouched', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'bc-profile-test-'));
    try {
      const dir = path.join(parent, 'nested', 'profile');
      await prepareUserDataDir(dir);
      const sentinel = path.join(dir, FIRST_RUN_SENTINEL);
      const before = await stat(sentinel);
      await prepareUserDataDir(dir);
      assert.equal((await stat(sentinel)).mtimeMs, before.mtimeMs);
      assert.equal(await readFile(sentinel, 'utf8'), '');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe('debugging port', () => {
  it('reserves a loopback port that can be bound again', async () => {
    const port = await reserveLoopbackPort();
    assert.ok(port > 0 && port < 65_536);
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen({ port, host: '127.0.0.1' }, () => server.close(resolve));
    });
  });

  it('refuses port 0 and out-of-range ports', () => {
    assert.throws(() => assertFixedDebuggingPort(0), /AutomationControlled/);
    assert.throws(() => assertFixedDebuggingPort(70_000), RangeError);
    assert.throws(() => assertFixedDebuggingPort('9222'), RangeError);
    assert.equal(assertFixedDebuggingPort(9222), 9222);
  });

  it('parses the DevTools listening line', () => {
    assert.deepEqual(
      parseDevToolsOutput(
        '\nDevTools listening on ws://127.0.0.1:9222/devtools/browser/1-2\n'
      ),
      {
        listening: {
          url: 'ws://127.0.0.1:9222/devtools/browser/1-2',
          host: '127.0.0.1',
          port: 9222,
        },
        bindFailed: false,
      }
    );
    assert.equal(
      parseDevToolsOutput(
        'DevTools listening on ws://[::1]:9222/devtools/browser/x'
      ).listening.host,
      '::1'
    );
  });

  it('classifies ownership, fallback and give-up output', () => {
    const owned = parseDevToolsOutput(
      'DevTools listening on ws://127.0.0.1:9222/devtools/browser/x'
    );
    assert.equal(classifyDevToolsOwnership(owned, 9222), 'owned');
    assert.equal(classifyDevToolsOwnership(owned, 9223), 'race');
    const fallback = parseDevToolsOutput(
      'bind() failed\nDevTools listening on ws://[::1]:9222/devtools/browser/x'
    );
    assert.equal(classifyDevToolsOwnership(fallback, 9222), 'race');
    assert.equal(
      classifyDevToolsOwnership(
        parseDevToolsOutput('Cannot start http server for devtools.'),
        9222
      ),
      'race'
    );
    // Unrelated bind failures (mDNS, media router) are not conclusive.
    assert.equal(
      classifyDevToolsOwnership(parseDevToolsOutput('bind() failed'), 9222),
      'pending'
    );
  });

  it('watches a stream across chunk boundaries', () => {
    const stream = new PassThrough();
    const watcher = watchDevToolsOutput(stream);
    assert.equal(watcher.available, true);
    stream.emit('data', 'DevTools listening on ws://127.0.0.1:92');
    assert.equal(watcher.state().listening, null);
    stream.emit('data', '22/devtools/browser/abc\n');
    assert.equal(watcher.state().listening.port, 9222);
    assert.equal(watchDevToolsOutput(undefined).available, false);
  });

  it('names the port in race errors', () => {
    const error = new PortRaceError(9222, 'bind failed');
    assert.equal(error.port, 9222);
    assert.match(error.message, /9222.*bind failed/);
  });
});
