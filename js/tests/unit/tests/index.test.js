import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createBrowserFixture,
  defineBrowserTests,
  loadTimingData,
  normalizeBrowserTestEngines,
  orderTestsByHistoricalDuration,
  parseShard,
  planTestShards,
  recordTestDuration,
  runBrowserScenario,
  runWithRetries,
  runWithTimeout,
  selectTestsForShard,
  updateTimingData,
  withBrowserCommander,
  writeFailureArtifacts,
} from '../../../src/tests/index.js';

describe('browser-commander/tests', () => {
  it('normalizes supported browser engines', () => {
    assert.deepStrictEqual(normalizeBrowserTestEngines(), [
      'playwright',
      'puppeteer',
    ]);
    assert.deepStrictEqual(normalizeBrowserTestEngines('Playwright'), [
      'playwright',
    ]);
    assert.throws(
      () => normalizeBrowserTestEngines('selenium'),
      /Unsupported browser test engine/
    );
  });

  it('updates cumulative timing averages', () => {
    const first = updateTimingData(
      { version: 1, updatedAt: null, tests: {} },
      {
        testId: 'slow test',
        durationMs: 100,
        now: new Date('2026-06-28T00:00:00Z'),
      }
    );
    const second = updateTimingData(first, {
      testId: 'slow test',
      durationMs: 300,
      now: new Date('2026-06-28T00:01:00Z'),
    });

    assert.strictEqual(second.tests['slow test'].runs, 2);
    assert.strictEqual(second.tests['slow test'].averageMs, 200);
    assert.strictEqual(second.tests['slow test'].lastMs, 300);
  });

  it('records timing data to disk', () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'bc-tests-'));
    const timingFile = path.join(
      tmpDir,
      '.browser-commander-test-timings.json'
    );

    try {
      recordTestDuration(
        { testId: 'writes timing', durationMs: 42 },
        { filePath: timingFile }
      );

      const loaded = loadTimingData({ filePath: timingFile });
      assert.strictEqual(loaded.tests['writes timing'].averageMs, 42);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('orders historically slow tests first while preserving ties', () => {
    const ordered = orderTestsByHistoricalDuration(
      [{ name: 'fast' }, { name: 'slow' }, { name: 'unknown' }],
      {
        version: 1,
        updatedAt: null,
        tests: {
          fast: { averageMs: 10 },
          slow: { averageMs: 100 },
        },
      }
    );

    assert.deepStrictEqual(
      ordered.map((entry) => entry.name),
      ['slow', 'fast', 'unknown']
    );
  });

  it('plans balanced shards using longest tests first', () => {
    const tests = [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }];
    const timingData = {
      version: 1,
      updatedAt: null,
      tests: {
        a: { averageMs: 90 },
        b: { averageMs: 40 },
        c: { averageMs: 30 },
        d: { averageMs: 10 },
      },
    };

    const shards = planTestShards(tests, { shardCount: 2, timingData });

    assert.deepStrictEqual(
      shards.map((shard) => shard.tests.map((entry) => entry.name)),
      [['a'], ['b', 'c', 'd']]
    );
    assert.deepStrictEqual(
      selectTestsForShard(tests, { shard: '2/2', timingData }).map(
        (entry) => entry.name
      ),
      ['b', 'c', 'd']
    );
  });

  it('parses Playwright-style shard strings', () => {
    assert.deepStrictEqual(parseShard('2/5'), {
      index: 2,
      total: 5,
      zeroBasedIndex: 1,
    });
    assert.throws(() => parseShard('0/5'), /between 1 and shard total/);
    assert.throws(() => parseShard('bad'), /1\/3/);
  });

  it('creates and closes a browser fixture with injected launchers', async () => {
    const calls = [];
    const page = { locator: () => ({}), context: () => ({}), $eval: true };
    const browser = {
      close: async () => calls.push('browser.close'),
    };

    const fixture = await createBrowserFixture({
      engine: 'playwright',
      launch: async (options) => {
        calls.push(`launch:${options.engine}`);
        return { browser, page };
      },
      makeCommander: ({ page: commanderPage }) => ({
        page: commanderPage,
        destroy: async () => calls.push('commander.destroy'),
      }),
    });

    assert.strictEqual(fixture.engine, 'playwright');
    assert.strictEqual(fixture.page, page);

    await fixture.close();
    assert.deepStrictEqual(calls, [
      'launch:playwright',
      'commander.destroy',
      'browser.close',
    ]);
  });

  it('cleans up fixture after successful callbacks', async () => {
    const calls = [];

    const result = await withBrowserCommander(
      {
        engine: 'puppeteer',
        launch: async () => ({
          browser: { close: async () => calls.push('browser.close') },
          page: {},
        }),
        makeCommander: () => ({
          destroy: async () => calls.push('commander.destroy'),
        }),
      },
      async ({ engine }) => {
        calls.push(`run:${engine}`);
        return 'ok';
      }
    );

    assert.strictEqual(result, 'ok');
    assert.deepStrictEqual(calls, [
      'run:puppeteer',
      'commander.destroy',
      'browser.close',
    ]);
  });

  it('retries failing operations', async () => {
    let attempts = 0;
    const retryEvents = [];

    const result = await runWithRetries(
      async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('try again');
        }
        return 'done';
      },
      {
        retries: 1,
        onRetry: async (event) => retryEvents.push(event.nextAttempt),
      }
    );

    assert.strictEqual(result, 'done');
    assert.deepStrictEqual(retryEvents, [2]);
  });

  it('times out slow operations', async () => {
    await assert.rejects(
      () =>
        runWithTimeout(
          () => new Promise((resolve) => setTimeout(resolve, 50)),
          { timeoutMs: 1, testId: 'slow operation' }
        ),
      /Timeout of 1ms exceeded for slow operation/
    );
  });

  it('writes error and screenshot artifacts on failure', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'bc-artifacts-'));

    try {
      const artifacts = await writeFailureArtifacts({
        page: {
          screenshot: async ({ path: screenshotPath }) => {
            assert.ok(screenshotPath.endsWith('.png'));
          },
        },
        error: new Error('broken'),
        testId: 'fixture fails',
        engine: 'playwright',
        artifactsDir: tmpDir,
      });

      assert.strictEqual(artifacts.length, 2);
      const errorJson = JSON.parse(readFileSync(artifacts[0], 'utf8'));
      assert.strictEqual(errorJson.message, 'broken');
      assert.strictEqual(errorJson.engine, 'playwright');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('captures failure artifacts before closing failed browser scenarios', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'bc-scenario-'));
    const calls = [];

    try {
      await assert.rejects(
        () =>
          runBrowserScenario(
            {
              name: 'fails',
              fn: async () => {
                throw new Error('scenario failure');
              },
            },
            {
              engine: 'playwright',
              artifactsDir: tmpDir,
              launch: async () => ({
                browser: { close: async () => calls.push('browser.close') },
                page: {
                  screenshot: async () => calls.push('page.screenshot'),
                },
              }),
              makeCommander: () => ({
                destroy: async () => calls.push('commander.destroy'),
              }),
            }
          ),
        /scenario failure/
      );

      assert.deepStrictEqual(calls, [
        'page.screenshot',
        'commander.destroy',
        'browser.close',
      ]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('orders registered browser entries by engine-specific timing history', () => {
    const calls = [];
    const fakeTestApi = Object.assign(
      (name, fn) => {
        calls.push({ kind: 'test', name, fn });
      },
      {
        skip: (name, fn) => calls.push({ kind: 'skip', name, fn }),
        only: (name, fn) => calls.push({ kind: 'only', name, fn }),
        todo: (name, fn) => calls.push({ kind: 'todo', name, fn }),
      }
    );

    defineBrowserTests(
      [
        { name: 'fast', fn: async () => {} },
        { name: 'slow', fn: async () => {} },
      ],
      {
        engines: ['playwright'],
        recordDurations: false,
        testApi: fakeTestApi,
        timingData: {
          version: 1,
          updatedAt: null,
          tests: {
            'fast [playwright]': { averageMs: 10 },
            'slow [playwright]': { averageMs: 100 },
          },
        },
      }
    );

    assert.deepStrictEqual(
      calls.map((entry) => entry.name),
      ['slow [playwright]', 'fast [playwright]']
    );
  });

  it('registers browser tests without duration recording for unit testing', () => {
    const calls = [];
    const fakeTestApi = Object.assign(
      (name, fn) => {
        calls.push({ kind: 'test', name, fn });
      },
      {
        skip: (name, fn) => calls.push({ kind: 'skip', name, fn }),
        only: (name, fn) => calls.push({ kind: 'only', name, fn }),
        todo: (name, fn) => calls.push({ kind: 'todo', name, fn }),
      }
    );
    const registrations = defineBrowserTests(
      [
        {
          name: 'metadata only',
          todo: true,
        },
      ],
      {
        engines: ['playwright', 'puppeteer'],
        recordDurations: false,
        order: false,
        testApi: fakeTestApi,
      }
    );

    assert.deepStrictEqual(
      registrations.map((entry) => entry.id),
      ['metadata only [playwright]', 'metadata only [puppeteer]']
    );
    assert.ok(registrations.every((entry) => entry.todo));
    assert.deepStrictEqual(
      calls.map((entry) => entry.kind),
      ['todo', 'todo']
    );
  });
});
