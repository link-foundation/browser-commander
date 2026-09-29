// feature-parity: cli.version cli.script cli.serve
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import {
  launchParams,
  parseCommandLine,
  UsageError,
} from '../../../src/cli/args.js';
import { TRACE_STOP_MARKER } from '../../../src/cli/commands.js';
import { EXIT_CODES, runCli } from '../../../src/cli/main.js';
import { runScript } from '../../../src/cli/script.js';
import { createFakeDependencies } from '../../helpers/cli-fakes.js';

/** Run the CLI against fakes and collect the printed documents. */
async function cli(argv, { fakes = createFakeDependencies(), ...io } = {}) {
  const documents = [];
  const exitCode = await runCli(argv, {
    stdout: { write: (text) => documents.push(JSON.parse(text)) },
    stdin: new PassThrough(),
    signals: new EventEmitter(),
    dependencies: fakes.dependencies,
    ...io,
  });
  return { exitCode, documents, document: documents.at(-1), ...fakes };
}

async function assertUsageErrors(commands) {
  for (const argv of commands) {
    assert.equal((await cli(argv)).exitCode, EXIT_CODES.USAGE, argv.join(' '));
  }
}

describe('parseCommandLine', () => {
  it('maps profile settings to real-browser launch options', () => {
    const { options } = parseCommandLine([
      'launch',
      '--pref',
      'browser.show_home_button=true',
      '--pref',
      'intl.accept_languages=en-US',
      '--local-state',
      'fre.has_user_seen_fre=false',
      '--default-browser-check',
    ]);
    assert.deepEqual(launchParams(options), {
      preferences: {
        browser: { show_home_button: true },
        intl: { accept_languages: 'en-US' },
      },
      localState: { fre: { has_user_seen_fre: false } },
      defaultBrowserCheck: true,
    });
    assert.throws(
      () => launchParams({ pref: ['__proto__.polluted=true'] }),
      UsageError
    );
  });
  it('parses positionals, kebab-case options and two-word commands', () => {
    assert.deepEqual(
      parseCommandLine([
        'fill',
        '#q',
        'hello',
        '--cdp-endpoint',
        'http://127.0.0.1:9222',
        '--restriction',
        'no-extensions',
        '--restriction',
        'no-sync',
      ]),
      {
        command: 'fill',
        args: { selector: '#q', value: 'hello' },
        options: {
          cdpEndpoint: 'http://127.0.0.1:9222',
          restriction: ['no-extensions', 'no-sync'],
        },
      }
    );
    assert.equal(
      parseCommandLine(['trace', 'view', 'dir']).command,
      'trace view'
    );
  });

  it('throws usage errors for bad command lines', () => {
    for (const argv of [
      [],
      ['--help'],
      ['bogus'],
      ['trace', 'pause'],
      ['goto'],
      ['goto', 'a', 'b'],
      ['version', '--nope'],
    ]) {
      assert.throws(() => parseCommandLine(argv), UsageError, argv.join(' '));
    }
  });
});

describe('runCli', () => {
  it('prints the version document', async () => {
    const { exitCode, documents } = await cli(['version']);

    assert.equal(exitCode, EXIT_CODES.OK);
    assert.deepEqual(documents, [
      { name: 'browser-commander', version: '0.0.0-test', language: 'js' },
    ]);
  });

  it('exits 64 with a JSON usage error', async () => {
    const { exitCode, document, launches } = await cli(['click']);

    assert.equal(exitCode, EXIT_CODES.USAGE);
    assert.equal(document.error.name, 'UsageError');
    assert.equal(launches.length, 0);
    assert.equal((await cli(['cookies', 'import'])).exitCode, 64);
    assert.equal((await cli(['serve'])).exitCode, 64);
    assert.equal((await cli(['goto', 'x', '--engine', 'nope'])).exitCode, 64);
  });

  it('exits 1 with a JSON error when the engine fails', async () => {
    const fakes = createFakeDependencies();
    fakes.dependencies.launchBrowser = async () => {
      throw new Error('Chrome is not installed');
    };

    const { exitCode, document } = await cli(['goto', 'https://a.test'], {
      fakes,
    });

    assert.equal(exitCode, EXIT_CODES.ERROR);
    assert.deepEqual(document, {
      error: { name: 'Error', message: 'Chrome is not installed' },
    });
  });

  it('launches a temporary browser for a page command and closes it', async () => {
    const { exitCode, document, launches, pages } = await cli([
      'eval',
      'document.title',
      '--url',
      'https://a.test/',
      '--browser',
      'chrome',
      // A value starting with "--" needs the --arg=VALUE form.
      '--arg=--lang=de',
      '--headless',
    ]);

    assert.equal(exitCode, 0);
    assert.deepEqual(document, { value: { expression: 'document.title' } });
    assert.deepEqual(launches[0].options, {
      engine: 'playwright',
      headless: true,
      channel: 'chrome',
      args: ['--lang=de'],
    });
    assert.equal(launches[0].closed, true);
    assert.deepEqual(pages[0].calls[0], ['goto', 'https://a.test/']);
  });

  it('attaches with --cdp-endpoint and leaves the browser running', async () => {
    const { exitCode, document, connections, launches } = await cli([
      'goto',
      'https://b.test/',
      '--cdp-endpoint',
      'http://127.0.0.1:9333',
      '--engine',
      'puppeteer',
    ]);

    assert.equal(exitCode, 0);
    assert.deepEqual(document, {
      url: 'https://b.test/',
      title: 'Title of https://b.test/',
    });
    assert.equal(launches.length, 0);
    const [{ options, disconnected, closed }] = connections;
    assert.deepEqual(
      { cdpEndpoint: options.cdpEndpoint, disconnected, closed },
      {
        cdpEndpoint: 'http://127.0.0.1:9333',
        disconnected: true,
        closed: false,
      }
    );
  });

  it('keeps a launched browser open until a signal arrives', async () => {
    const signals = new EventEmitter();
    const documents = [];
    const fakes = createFakeDependencies();
    const running = runCli(['launch', '--keep-open'], {
      stdout: { write: (text) => documents.push(JSON.parse(text)) },
      stdin: new PassThrough(),
      signals,
      dependencies: fakes.dependencies,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(documents[0].cdpEndpoint, 'http://127.0.0.1:9222');
    assert.deepEqual(documents[0].args, ['--user-data-dir=/tmp/fake-profile']);
    assert.equal(fakes.launches[0].closed, false);
    signals.emit('SIGTERM');

    assert.equal(await running, 0);
    assert.equal(documents.length, 1);
    assert.equal(fakes.launches[0].closed, true);
  });

  it('closes a launch without --keep-open right after printing', async () => {
    const { exitCode, document, launches } = await cli(['launch']);

    assert.equal(exitCode, 0);
    assert.equal(document.remoteDebuggingPort, 9222);
    assert.equal(launches[0].closed, true);
  });

  it('exits 2 when doctor finds an unlisted difference', async () => {
    const fakes = createFakeDependencies();
    fakes.dependencies.measureParity = async () => ({
      ok: false,
      unlisted: [{ property: 'navigator.webdriver' }],
    });

    const { exitCode, document } = await cli(['doctor'], { fakes });

    assert.equal(exitCode, EXIT_CODES.UNLISTED_DIFFERENCE);
    assert.equal(document.unlisted[0].property, 'navigator.webdriver');
    assert.equal((await cli(['doctor'])).exitCode, 0);
  });

  it('splits profile migrate --include on commas', async () => {
    const { document } = await cli([
      'profile',
      'migrate',
      '--from',
      'chrome',
      '--include',
      'cookies, bookmarks',
      '--domain',
      'a.test',
    ]);

    assert.deepEqual(document.options, {
      from: 'chrome',
      include: ['cookies', 'bookmarks'],
      domains: ['a.test'],
    });
  });

  it('prints a profile snapshot report', async () => {
    const { exitCode, document } = await cli([
      'profile',
      'snapshot',
      '--from',
      'edge',
      '--profile',
      'Profile 2',
      '--to',
      'copy',
    ]);

    assert.equal(exitCode, 0);
    assert.equal(document.source.browser, 'edge');
    assert.equal(document.source.profile, 'Profile 2');
    assert.equal(document.target, path.resolve('copy'));
    assert.equal(
      (await cli(['profile', 'snapshot', '--to', 'copy'])).exitCode,
      64
    );
  });

  it('launches a snapshot with --attach snapshot', async () => {
    const fakes = createFakeDependencies();
    const launchBrowser = fakes.dependencies.launchBrowser;
    fakes.dependencies.launchBrowser = async (options) => ({
      ...(await launchBrowser(options)),
      attach: { mode: 'snapshot', snapshot: { target: '/tmp/s' } },
    });

    const { exitCode, document, launches } = await cli(
      ['launch', '--attach', 'snapshot', '--from', 'chrome', '--profile', 'P'],
      { fakes }
    );

    assert.equal(exitCode, 0);
    assert.deepEqual(launches[0].options.attach, {
      mode: 'snapshot',
      browser: 'chrome',
      profile: 'P',
    });
    assert.equal(document.attach.mode, 'snapshot');
    await assertUsageErrors([
      ['launch', '--attach', 'extension'],
      ['launch', '--from', 'chrome'],
      ['launch', '--attach', 'snapshot', '--user-data-dir', '/tmp/x'],
      ['launch', '--attach', 'snapshot', '--launch', 'engine'],
    ]);
  });

  it('attaches through the extension and closes the relay', async () => {
    const { exitCode, document, relays } = await cli([
      'attach',
      '--mode',
      'extension',
      '--port',
      '9444',
      '--timeout',
      '5000',
    ]);

    assert.equal(exitCode, 0);
    assert.deepEqual(Object.keys(document), [
      'mode',
      'extension',
      'tabs',
      'differences',
    ]);
    assert.equal(document.mode, 'extension');
    assert.equal(relays[0].options.port, 9444);
    assert.equal(relays[0].options.timeoutMs, 5000);
    assert.equal(relays[0].closed, true);
    await assertUsageErrors([
      ['attach'],
      ['attach', '--mode', 'snapshot'],
      ['attach', '--mode', 'extension', '--port', 'x'],
    ]);
  });

  it('runs a script and exits 1 when a step failed', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-cli-run-'));
    const script = path.join(dir, 'script.json');
    await writeFile(
      script,
      JSON.stringify({
        steps: [
          { method: 'session.launch' },
          { method: 'page.goto', params: { session: '$session', url: 'x:' } },
          { method: 'nope' },
          { method: 'session.close', params: { session: '$session' } },
        ],
      })
    );
    try {
      const { exitCode, document, launches } = await cli([
        'run',
        script,
        '--headless',
      ]);

      assert.equal(exitCode, 1);
      assert.deepEqual(
        document.results.map((entry) => entry.method),
        ['session.launch', 'page.goto', 'nope', 'session.close']
      );
      assert.deepEqual(document.results[2].error, {
        code: -32601,
        message: 'Unknown method: nope',
      });
      assert.deepEqual(document.results[3].result, { closed: true });
      assert.equal(launches[0].options.headless, true);

      const missing = await cli(['run', path.join(dir, 'missing.json')]);
      assert.equal(missing.exitCode, 1);
      assert.match(missing.document.error.message, /Cannot read/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stops trace start when trace stop writes the marker', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-cli-trace-'));
    try {
      const recording = cli(['trace', 'start', '--out', dir]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const stop = await cli(['trace', 'stop', '--out', dir]);
      assert.deepEqual(stop.document, { trace: dir, stopRequested: true });
      assert.equal(
        await readFile(path.join(dir, TRACE_STOP_MARKER), 'utf8'),
        ''
      );

      const { exitCode, document } = await recording;
      assert.equal(exitCode, 0);
      assert.deepEqual(document, { trace: dir, stopped: true });

      const view = await cli(['trace', 'view', dir]);
      assert.deepEqual(view.document, {
        viewer: path.join(dir, 'viewer.html'),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('serves JSON-RPC over the given stdin', async () => {
    const stdin = new PassThrough();
    const documents = [];
    const serving = runCli(['serve', '--stdio'], {
      stdout: { write: (text) => documents.push(JSON.parse(text)) },
      stdin,
      signals: new EventEmitter(),
      dependencies: createFakeDependencies().dependencies,
    });
    stdin.end(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'version' })}\n`
    );

    assert.equal(await serving, 0);
    assert.deepEqual(documents, [
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          name: 'browser-commander',
          version: '0.0.0-test',
          language: 'js',
        },
      },
    ]);
  });
});

describe('runScript', () => {
  it('rejects scripts without steps', async () => {
    await assert.rejects(runScript({}), /\{"steps": \[\.\.\.\]\}/u);
    await assert.rejects(runScript({ steps: [{}] }), /Step 1 has no/u);
  });
});
