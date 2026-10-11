import assert from 'node:assert/strict';
import { it } from 'node:test';
import path from 'node:path';
import { physicalPath } from '../../../src/browser/browser-profile-files.js';
import {
  matchesSessionProcess,
  processArguments,
} from '../../../src/browser/session-adoption.js';
import {
  connectBrowserWithDependencies,
  pickForegroundPage,
} from '../../../src/browser/connector.js';

it('keeps plain profile paths when macOS privacy protection denies resolution', () => {
  for (const code of ['EPERM', 'EACCES']) {
    assert.equal(
      physicalPath('/tmp/dedicated-profile', () => {
        throw Object.assign(new Error('protected'), { code });
      }),
      path.resolve('/tmp/dedicated-profile')
    );
  }
});

it('verifies adoption profile, port and browser process across process-list formats', () => {
  const options = {
    userDataDir: '/tmp/managed profile',
    remoteDebuggingPort: 9222,
  };
  const commands = [
    '/usr/bin/google-chrome --user-data-dir="/tmp/managed profile" --remote-debugging-port=9222',
    '/opt/google/chrome/chrome --user-data-dir="/tmp/managed profile" --remote-debugging-port=9222',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/managed profile --remote-debugging-port=9222',
  ];
  for (const command of commands) {
    assert.equal(
      matchesSessionProcess(processArguments(command), options),
      true
    );
    for (const changed of [
      command.replace('9222', '9223'),
      command.replace('managed profile', 'other profile'),
      `${command} --type=renderer`,
    ]) {
      assert.equal(
        matchesSessionProcess(processArguments(changed), options),
        false
      );
    }
  }
  assert.equal(
    matchesSessionProcess(
      [
        '/tmp/fake-chrome-process',
        '--user-data-dir=/tmp/managed profile',
        '--remote-debugging-port=9222',
      ],
      options
    ),
    false
  );
  const windows = processArguments(
    '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\managed profile" --remote-debugging-port=9222'
  );
  assert.equal(
    windows[0],
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  );
  assert.equal(windows[1], '--user-data-dir=C:\\managed profile');
});

it('falls back from remembered targets and honors ranked URL matchers', async () => {
  const pages = [
    'https://example.test/first',
    'https://example.test/preferred',
  ].map((url) => ({ url: () => url, evaluate: async () => 'visible' }));
  assert.equal(
    await pickForegroundPage(pages, {
      targetId: 'stale',
      fallback: true,
      url: [/preferred/, /first/],
    }),
    pages[1]
  );
  assert.equal(
    await pickForegroundPage(pages, { targetId: 'stale', fallback: true }),
    pages[0]
  );
  assert.equal(
    await pickForegroundPage([], { targetId: 'stale', fallback: true }),
    undefined
  );
  await assert.rejects(
    pickForegroundPage(pages, { targetId: 'explicit' }),
    /No tab matches/
  );
});

it('disconnects attached Playwright and Puppeteer browsers on selection failure', async () => {
  for (const engine of ['playwright', 'puppeteer']) {
    let detached = 0;
    const browser = {
      contexts: () => [{ pages: () => [] }],
      pages: async () => [],
      close: async () => detached++,
      disconnect: async () => detached++,
    };
    await assert.rejects(
      connectBrowserWithDependencies(
        { engine, cdpEndpoint: 'http://127.0.0.1:9222', targetId: 'missing' },
        {
          loadPlaywright: async () => ({
            chromium: { connectOverCDP: async () => browser },
          }),
          loadPuppeteer: async () => ({ connect: async () => browser }),
        }
      ),
      /No tab matches/
    );
    assert.equal(detached, 1);
  }
});

it('forwards noDefaults and recovers only the zero-page context-management error', async () => {
  const calls = [];
  const page = { url: () => 'about:blank' };
  const browser = {
    contexts: () => [{ pages: () => [], newPage: async () => page }],
    close: async () => {},
  };
  const loadPlaywright = async () => ({
    chromium: {
      connectOverCDP: async (_, options) => {
        calls.push(options);
        if (calls.length === 1 && options.noDefaults === undefined) {
          throw new Error(
            'Protocol error (Browser.setDownloadBehavior): Browser context management is not supported.'
          );
        }
        return browser;
      },
    },
  });
  const result = await connectBrowserWithDependencies(
    { cdpEndpoint: 'http://127.0.0.1:9222' },
    { loadPlaywright }
  );
  assert.equal(result.page, page);
  assert.deepEqual(calls, [{}, { noDefaults: true }]);
  for (const noDefaults of [false, true]) {
    await connectBrowserWithDependencies(
      { cdpEndpoint: 'http://127.0.0.1:9222', noDefaults },
      { loadPlaywright }
    );
    assert.equal(calls.at(-1).noDefaults, noDefaults);
  }
});
