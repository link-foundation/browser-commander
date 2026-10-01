// feature-parity: parity.measure@native-typed
import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  classifyDifferences,
  compareCommandLines,
  measureParity,
  parseSwitches,
} from '../../../src/browser/parity.js';

const CHROME = '/opt/google/chrome/chrome';

describe('parsing a chrome://version command line', () => {
  it('splits switches and drops the executable and start URL', () => {
    const switches = parseSwitches(
      `${CHROME} --user-data-dir=/tmp/a --ozone-platform=x11 --flag-switches-begin --flag-switches-end about:blank`
    );
    assert.deepEqual(
      [...switches],
      [
        ['--user-data-dir', '/tmp/a'],
        ['--ozone-platform', 'x11'],
        ['--flag-switches-begin', null],
        ['--flag-switches-end', null],
      ]
    );
  });

  it('keeps a value that contains spaces and drops only a trailing URL', () => {
    assert.deepEqual(
      [
        ...parseSwitches(
          `${CHROME} --user-data-dir=/tmp/My Profile --flag data:text/html,hi`
        ),
      ],
      [
        ['--user-data-dir', '/tmp/My Profile'],
        ['--flag', null],
      ]
    );
    assert.deepEqual(
      [...parseSwitches(`${CHROME} --enable-features=A,B`)],
      [['--enable-features', 'A,B']]
    );
  });

  it('stays linear on a long run of whitespace', () => {
    const started = Date.now();
    parseSwitches(`--a${' '.repeat(200000)}x`);
    assert.ok(Date.now() - started < 1000);
  });

  it('accepts an argument array', () => {
    assert.deepEqual(
      [...parseSwitches(['--headless=new', 'https://example.com'])],
      [['--headless', 'new']]
    );
  });
});

describe('comparing command lines', () => {
  it('reports only what the reference browser did not have', () => {
    const comparison = compareCommandLines(
      `${CHROME} --user-data-dir=/tmp/a --remote-debugging-port=41000 --ozone-platform=x11 about:blank`,
      `${CHROME} --user-data-dir=/tmp/b --remote-debugging-port=42000 --disable-sync --ozone-platform=x11 --flag-switches-begin --flag-switches-end about:blank`
    );
    assert.deepEqual(comparison.extra, ['--disable-sync']);
    assert.deepEqual(comparison.missing, []);
    assert.deepEqual(comparison.changed, []);
    // The port is how the library attaches; it is not a difference.
    assert.deepEqual(comparison.attachment, ['--remote-debugging-port=42000']);
  });

  it('reports missing and changed switches and feature lists', () => {
    const comparison = compareCommandLines(
      ['--user-data-dir=/tmp/a', '--lang=de', '--mute-audio'],
      ['--user-data-dir=/tmp/b', '--lang=en', '--disable-features=B,A']
    );
    assert.deepEqual(comparison.missing, ['--mute-audio']);
    assert.deepEqual(comparison.changed, [
      { name: '--lang', reference: 'de', candidate: 'en' },
    ]);
    assert.deepEqual(comparison.features, {
      '--disable-features': { reference: [], candidate: ['A', 'B'] },
    });
  });
});

describe('explaining differences', () => {
  const extraSwitch = {
    path: 'commandLine.extra.--disable-sync',
    reference: null,
    candidate: '--disable-sync',
  };

  it('leaves an unexplained difference unlisted', () => {
    const { unlisted } = classifyDifferences([extraSwitch], {
      launch: 'real',
      requestedArgs: [],
    });
    assert.deepEqual(unlisted, [
      {
        path: 'commandLine.extra.--disable-sync',
        expected: null,
        actual: '--disable-sync',
        limitation: null,
        requested: false,
      },
    ]);
  });

  it('accepts a switch the caller asked for', () => {
    const { differences, unlisted } = classifyDifferences([extraSwitch], {
      launch: 'real',
      requestedArgs: ['--disable-sync'],
    });
    assert.equal(differences[0].requested, true);
    assert.deepEqual(unlisted, []);
  });

  it('ties engine switches and known leaks to catalogue entries', () => {
    const { differences, unlisted } = classifyDifferences(
      [
        extraSwitch,
        {
          path: 'navigator.userAgentData.brands.0.brand',
          reference: 'Not)A;Brand',
          candidate: 'Not.A/Brand',
        },
        { path: 'navigator.webdriver', reference: false, candidate: true },
      ],
      { launch: 'engine', attached: true, requestedArgs: [] }
    );
    assert.deepEqual(
      differences.map((entry) => entry.limitation),
      [
        'engine-launch-switches',
        'grease-brand-not-reproduced',
        'automation-controlled-is-launch-only',
      ]
    );
    assert.deepEqual(unlisted, []);
  });

  it('ties field-trial surfaces to the engine switches that move them', () => {
    const surfaces = [
      {
        path: 'navigator.keys',
        reference: ['clipboard'],
        candidate: ['clipboard', 'runAdAuction'],
      },
      {
        path: 'worker.navigator.languages',
        reference: ['en-US'],
        candidate: ['en-US', 'en'],
      },
    ];
    const engine = classifyDifferences(surfaces, {
      launch: 'engine',
      extraSwitches: ['--disable-field-trial-config'],
      requestedArgs: [],
    });
    assert.deepEqual(engine.unlisted, []);
    assert.deepEqual(
      engine.differences.map((entry) => entry.limitation),
      ['engine-launch-switches', 'engine-launch-switches']
    );

    // The same surfaces stay unexplained for the real launch, and for an
    // engine launch that did not touch the feature configuration.
    for (const context of [
      { launch: 'real', extraSwitches: ['--disable-field-trial-config'] },
      { launch: 'engine', extraSwitches: ['--disable-sync'] },
    ]) {
      const { unlisted } = classifyDifferences(surfaces, {
        ...context,
        requestedArgs: [],
      });
      assert.equal(unlisted.length, 2);
    }
  });

  it('does not excuse navigator.webdriver for a launched browser', () => {
    const { unlisted } = classifyDifferences(
      [{ path: 'navigator.webdriver', reference: false, candidate: true }],
      { launch: 'real', attached: false, requestedArgs: [] }
    );
    assert.equal(unlisted.length, 1);
  });
});

function fakes({ candidateCommandLine, candidateReport = { a: 1 } }) {
  const calls = [];
  const session = {
    launch: 'real',
    args: [],
    page: {
      goto: async (url) => calls.push(['goto', url]),
    },
    browser: { close: async () => calls.push(['close']) },
  };
  const reports = [{ a: 1 }, candidateReport];
  const dependencies = {
    resolveLaunchExecutable: async () => CHROME,
    launchBrowser: async (options) => {
      calls.push(['launch', options]);
      return session;
    },
    readProbe: async () => 'async () => ({})',
    startServer: async () => ({
      url: (token) => `http://127.0.0.1:1/probe/${token}`,
      waitForReport: async () => reports.pop(),
      close: async () => calls.push(['server-close']),
    }),
    captureReference: async () => reports.pop(),
    readReferenceVersion: async ({ headless }) => ({
      commandLine: `${CHROME} --user-data-dir=/tmp/r --remote-debugging-port=1${
        headless ? ' --headless=new --ozone-platform=headless' : ''
      } about:blank`,
    }),
    readVersionPage: async () => ({
      commandLine: candidateCommandLine,
      version: '153.0.8010.36\n (Official Build)\n (64-bit)',
      executablePath: CHROME,
    }),
  };
  return { calls, session, dependencies };
}

describe('measureParity', () => {
  it('is ok when the launched browser matches the hand-started one', async () => {
    const { calls, dependencies } = fakes({
      candidateCommandLine: `${CHROME} --user-data-dir=/tmp/c --remote-debugging-port=2 --headless=new --ozone-platform=headless about:blank`,
    });
    const report = await measureParity({ headless: true }, dependencies);
    assert.equal(report.ok, true);
    assert.deepEqual(report.unlisted, []);
    assert.deepEqual(report.commandLine.extra, []);
    assert.deepEqual(report.commandLine.attachment, [
      '--remote-debugging-port=2',
    ]);
    assert.equal(
      report.browser.version,
      '153.0.8010.36 (Official Build) (64-bit)'
    );
    assert.equal(report.browser.launch, 'real');
    assert.deepEqual(
      calls.map(([name]) => name),
      ['launch', 'goto', 'close', 'server-close']
    );
  });

  it('fails on an unlisted switch or probe difference', async () => {
    const { dependencies } = fakes({
      candidateCommandLine: `${CHROME} --user-data-dir=/tmp/c --remote-debugging-port=2 --disable-sync about:blank`,
      candidateReport: { a: 2 },
    });
    const report = await measureParity({}, dependencies);
    assert.equal(report.ok, false);
    assert.deepEqual(
      report.unlisted.map((entry) => entry.path),
      ['commandLine.extra.--disable-sync', 'a']
    );
  });

  it('measures a provided session and leaves it open', async () => {
    const { calls, session, dependencies } = fakes({
      candidateCommandLine: `${CHROME} --user-data-dir=/tmp/c --remote-debugging-port=2 about:blank`,
    });
    const report = await measureParity(
      { session: { ...session, executablePath: CHROME } },
      dependencies
    );
    assert.equal(report.ok, true);
    assert.deepEqual(
      calls.map(([name]) => name),
      ['goto', 'server-close']
    );
  });
});
