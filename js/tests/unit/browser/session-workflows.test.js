import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  installSessionPersistence,
  sessionPersistencePath,
} from '../../../src/browser/session-persistence.js';
import {
  findSiteSessions,
  readBrowserCookieSession,
} from '../../../src/browser/browser-cookie-session.js';

it('discovery reads Firefox and Safari through their existing cookie readers', async () => {
  const read = [];
  const sessions = await findSiteSessions(
    {
      domains: ['example.test'],
      sources: ['firefox', 'safari'].map((browser) => ({
        browser,
        path: '/artificial/profile',
      })),
    },
    {
      readCookies: async (options) => {
        read.push(options);
        return [
          { name: 'session', domain: '.example.test' },
          { domain: 'notexample.test' },
        ];
      },
    }
  );
  assert.equal(read.length, 2);
  assert.ok(
    read.every(
      (options) => options.via === 'database' && options.cache === false
    )
  );
  assert.ok(
    sessions.every(
      (session) =>
        session.cookies.length === 1 &&
        session.loggedIn === null &&
        !session.error
    )
  );
});

it('non-Chromium session validation imports cookies into a disposable engine browser', async () => {
  let seeded;
  let closed = 0;
  const sessions = await findSiteSessions(
    {
      domains: ['example.test'],
      sources: [{ browser: 'firefox', path: '/artificial/profile' }],
      isLoggedIn: async ({ cookies }) => cookies.length === 1,
    },
    {
      readCookies: async () => [
        {
          name: 'session',
          value: 'artificial',
          domain: '.example.test',
          path: '/',
        },
      ],
      launch: async (options) => {
        assert.equal(options.launch, 'engine');
        assert.equal(options.userDataDir, undefined);
        return {
          page: {
            context: () => ({
              addCookies: async (cookies) => {
                seeded = cookies;
              },
            }),
          },
          close: async () => closed++,
        };
      },
    }
  );
  assert.equal(seeded.length, 1);
  assert.equal(closed, 1);
  assert.equal(sessions[0].loggedIn, true);
});

it('browser reads request cookie-only copies, filter domains and always close', async () => {
  let closed = 0,
    launched;
  const result = {
    page: {
      context: () => ({
        storageState: async () => ({
          cookies: [{ domain: '.example.test' }, { domain: 'notexample.test' }],
          origins: [],
        }),
      }),
    },
    close: async () => closed++,
  };
  const cookies = await readBrowserCookieSession(
    {
      browser: 'chrome',
      profileDir: '/artificial/Default',
      domainFilter: 'example.test',
    },
    {
      launch: async (options) => {
        launched = options;
        return result;
      },
    }
  );
  assert.equal(cookies.length, 1);
  assert.deepEqual(launched.attach.include, ['cookies']);
  assert.equal(closed, 1);
});
it('live validation failure closes the snapshot and records the error', async () => {
  let closed = 0;
  const results = await findSiteSessions(
    {
      domains: ['example.test'],
      sources: [{ browser: 'chrome', path: '/artificial/Default' }],
      isLoggedIn: async () => {
        throw new Error('artificial validation failure');
      },
    },
    {
      launch: async () => ({
        page: {
          context: () => ({
            storageState: async () => ({ cookies: [], origins: [] }),
          }),
        },
        close: async () => closed++,
      }),
    }
  );
  assert.equal(closed, 1);
  assert.match(results[0].error, /validation failure/);
});
it('persistence requires a dedicated profile and writes only session cookies with restricted permissions', async () => {
  assert.throws(
    () => sessionPersistencePath({ persistSessionCookies: true }),
    /dedicated/
  );
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bc-session-test-'));
  try {
    let closed = 0;
    const state = {
      cookies: [
        { name: 'session', expires: -1 },
        { name: 'persistent', expires: 9999999999 },
      ],
      origins: [],
    };
    const page = { context: () => ({ storageState: async () => state }) };
    const result = await installSessionPersistence(
      { page, browser: {}, close: async () => closed++ },
      { userDataDir: directory, persistSessionCookies: true }
    );
    await Promise.all([result.close(), result.close()]);
    const file = path.join(directory, 'browser-commander-session.json');
    assert.equal(closed, 1);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).cookies, [
      state.cookies[0],
    ]);
    if (process.platform !== 'win32') {
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('session discovery continues after a source close failure', async () => {
  let closed = 0;
  const sessions = await findSiteSessions(
    {
      domains: ['example.test'],
      sources: [
        { browser: 'chrome', path: '/artificial/Default' },
        { browser: 'chrome', path: '/artificial/Profile 1' },
      ],
    },
    {
      launch: async () => ({
        page: {
          context: () => ({
            storageState: async () => ({ cookies: [], origins: [] }),
          }),
        },
        close: async () => {
          closed++;
          throw new Error('artificial close failure');
        },
      }),
    }
  );
  assert.equal(sessions.length, 2);
  assert.equal(closed, 2);
  assert.ok(sessions.every((session) => /close failure/.test(session.error)));
});
