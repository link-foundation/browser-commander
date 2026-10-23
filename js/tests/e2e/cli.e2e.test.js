/**
 * Real-browser tests of the `browser-commander` CLI (issue #104).
 *
 * The binary runs as a separate process through command-stream, the way a
 * shell script, a Rust program or a Python program would use it:
 *
 * - `run tests/cli-contract/basic.json` must print, after normalization,
 *   exactly `tests/cli-contract/basic.expected.json`. The Rust and Python
 *   CLIs are checked against the same file, so all three agree.
 * - `launch --keep-open` leaves a browser running that later `goto` and
 *   `eval` commands reach with `--cdp-endpoint`.
 * - A `--user-data-dir` keeps a session cookie from one command's browser to
 *   the next, and `--no-keep-session-cookies` drops it (issue #187).
 *
 * Run with: npm run test:e2e:cli
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProcessRunner } from 'command-stream/process-runner';

import { normalizeRunOutput } from '../../../tests/cli-contract/normalize.mjs';
import { runCommand } from '../../src/utilities/subprocess.js';
import { SANDBOX_ARGS } from '../helpers/e2e-browser.js';
import { startSessionCookieHost } from '../helpers/fixture-server.js';
import { repoPath } from '../helpers/repo.js';
import {
  closeRemoteBrowser,
  SESSION_METADATA,
} from '../../src/browser/persistent-session.js';

const BIN = fileURLToPath(
  new URL('../../bin/browser-commander.js', import.meta.url)
);
const ENGINES = ['playwright', 'puppeteer'];
const E2E = { skip: !process.env.RUN_E2E, timeout: 180_000 };

/** Options that pick the test browser: CHROME_PATH and sandbox arguments. */
function browserOptions(engine) {
  return [
    '--engine',
    engine,
    ...(process.env.CHROME_PATH
      ? ['--executable-path', process.env.CHROME_PATH]
      : []),
    // "--arg=VALUE": a value that starts with "--" cannot follow a space.
    ...SANDBOX_ARGS.map((arg) => `--arg=${arg}`),
  ];
}

/** Run the CLI to completion and parse its one JSON document. */
async function browserCommander(args) {
  const { code, stdout, stderr } = await runCommand(
    process.execPath,
    [BIN, ...args],
    { check: false }
  );
  let document;
  try {
    document = JSON.parse(stdout);
  } catch {
    throw new Error(`No JSON from ${args.join(' ')}: ${stdout}\n${stderr}`);
  }
  return { code, document };
}

/**
 * Start `launch --keep-open` with stdin kept open, and resolve with its
 * document once it has been printed.
 */
function startKeptOpenBrowser(engine) {
  const runner = new ProcessRunner(
    {
      mode: 'exec',
      file: process.execPath,
      args: [
        BIN,
        'launch',
        '--keep-open',
        '--headless',
        ...browserOptions(engine),
      ],
    },
    { mirror: false, capture: true, stdin: 'pipe' }
  );
  let output = '';
  const printed = new Promise((resolve, reject) => {
    runner.on('stdout', (chunk) => {
      output += chunk.toString();
      if (output.includes('\n')) {
        resolve(JSON.parse(output.split('\n')[0]));
      }
    });
    Promise.resolve(runner).then(
      (result) =>
        reject(new Error(`launch exited early: ${output}${result.stderr}`)),
      reject
    );
  });
  runner.start();
  return { runner, printed };
}

for (const engine of ENGINES) {
  describe(`E2E - browser-commander CLI with ${engine} (issue #104)`, () => {
    it(
      'run basic.json matches the cross-language expected output',
      E2E,
      async () => {
        const { code, document } = await browserCommander([
          'run',
          repoPath('tests', 'cli-contract', 'basic.json'),
          ...browserOptions(engine),
        ]);

        const expected = JSON.parse(
          readFileSync(
            repoPath('tests', 'cli-contract', 'basic.expected.json'),
            'utf8'
          )
        );
        assert.deepEqual(normalizeRunOutput(document), expected);
        assert.equal(code, 0);
      }
    );

    it(
      'launch --keep-open serves goto and eval over --cdp-endpoint',
      E2E,
      async () => {
        const { runner, printed } = startKeptOpenBrowser(engine);
        let launched;
        try {
          launched = await printed;
          assert.match(launched.cdpEndpoint, /^http:\/\/127\.0\.0\.1:\d+$/u);
          const attach = [
            '--cdp-endpoint',
            launched.cdpEndpoint,
            '--engine',
            engine,
          ];

          const url = `data:text/html,${encodeURIComponent(
            '<title>Kept open</title><p id="x">42</p>'
          )}`;
          const goto = await browserCommander(['goto', url, ...attach]);
          assert.equal(goto.code, 0);
          assert.deepEqual(goto.document, { url, title: 'Kept open' });

          // The second command attaches again and sees the page the first
          // one left behind: the browser outlived both commands.
          const evaluated = await browserCommander([
            'eval',
            "document.title + ':' + document.querySelector('#x').textContent",
            ...attach,
          ]);
          assert.equal(evaluated.code, 0);
          assert.deepEqual(evaluated.document, { value: 'Kept open:42' });
        } finally {
          runner.kill('SIGTERM');
          await Promise.resolve(runner).catch(() => {});
          if (launched?.userDataDir) {
            const file = path.join(launched.userDataDir, SESSION_METADATA);
            const metadata = JSON.parse(await readFile(file, 'utf8'));
            await closeRemoteBrowser(metadata.webSocketDebuggerUrl);
            await assert.rejects(fetch(`${launched.cdpEndpoint}/json/version`));
            // Chrome finishes flushing its profile after closing CDP.
            await rm(launched.userDataDir, {
              recursive: true,
              force: true,
              maxRetries: 5,
            });
          }
        }
      }
    );

    it(
      '--user-data-dir keeps a session cookie into the next command (issue #187)',
      E2E,
      async () => {
        const server = await startSessionCookieHost();
        const profiles = [];
        // Each eval launches a browser on the profile and closes it.
        const cookieAfter = async (route, profile, extra = []) => {
          const { code, document } = await browserCommander([
            'eval',
            'document.cookie',
            '--url',
            `${server.baseUrl}${route}`,
            '--user-data-dir',
            profile,
            '--headless',
            ...extra,
            ...browserOptions(engine),
          ]);
          assert.equal(code, 0);
          return document.value;
        };
        try {
          for (const [extra, expected] of [
            [[], 'sid=logged-in'],
            [['--no-keep-session-cookies'], ''],
          ]) {
            const profile = await mkdtemp(
              path.join(os.tmpdir(), 'browser-commander-cli-187-')
            );
            profiles.push(profile);
            assert.equal(
              await cookieAfter('/login', profile, extra),
              'sid=logged-in'
            );
            assert.equal(await cookieAfter('/check', profile, extra), expected);
          }
        } finally {
          await server.close();
          await Promise.all(
            profiles.map((profile) =>
              rm(profile, { recursive: true, force: true, maxRetries: 5 })
            )
          );
        }
      }
    );
  });
}
