/**
 * Browser Commander test helpers built on top of test-anywhere.
 *
 * The helpers keep the generic test definition layer in test-anywhere while
 * adding browser fixtures, engine matrices, timing history, retries, and
 * failure artifacts for browser-commander users.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test as baseTest } from 'test-anywhere';
import { launchBrowser } from '../browser/launcher.js';
import { makeBrowserCommander } from '../factory.js';

export {
  test,
  it,
  describe,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  before,
  after,
  assert,
  expect,
  assertEquals,
  assertNotEquals,
  assertStrictEquals,
  assertNotStrictEquals,
  assertExists,
  assertMatch,
  assertArrayIncludes,
  getRuntime,
  setDefaultTimeout,
} from 'test-anywhere';

export const SUPPORTED_BROWSER_TEST_ENGINES = Object.freeze([
  'playwright',
  'puppeteer',
]);

export const DEFAULT_TIMINGS_FILENAME = '.browser-commander-test-timings.json';
export const DEFAULT_ARTIFACTS_DIR = 'test-results/browser-commander';

const TIMING_DATA_VERSION = 1;

function createEmptyTimingData() {
  return {
    version: TIMING_DATA_VERSION,
    updatedAt: null,
    tests: {},
  };
}

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function normalizeTestId(testLike) {
  if (typeof testLike === 'string') {
    return testLike;
  }
  if (testLike?.id) {
    return testLike.id;
  }
  if (testLike?.name) {
    return testLike.name;
  }
  throw new Error('Test entries must include a name or id');
}

function historicalDurationMs(testLike, timingData) {
  const entry = timingData.tests?.[normalizeTestId(testLike)];
  return Number.isFinite(entry?.averageMs) ? entry.averageMs : 0;
}

function formatBrowserTestName(name, engine) {
  return `${name} [${engine}]`;
}

function browserTestId(scenario, engine) {
  return formatBrowserTestName(scenario.id || scenario.name, engine);
}

function nowIso(now) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString();
}

function sortedTimingData(data) {
  const tests = {};
  for (const key of Object.keys(data.tests || {}).sort()) {
    tests[key] = data.tests[key];
  }
  return {
    version: TIMING_DATA_VERSION,
    updatedAt: data.updatedAt || null,
    tests,
  };
}

function mergeOptions(base = {}, override = {}) {
  return {
    ...base,
    ...override,
  };
}

function normalizeScenario(scenario) {
  assertObject(scenario, 'Browser test scenario');

  if (!scenario.name) {
    throw new Error('Browser test scenario name is required');
  }

  if (!scenario.todo && typeof scenario.fn !== 'function') {
    throw new Error(`Browser test "${scenario.name}" must include a function`);
  }

  return {
    ...scenario,
    id: scenario.id || scenario.name,
  };
}

function registrationForScenario(scenario, skipEngine, testApi) {
  if (scenario.todo) {
    return testApi.todo;
  }
  if (scenario.skip || skipEngine) {
    return testApi.skip;
  }
  if (scenario.only) {
    return testApi.only;
  }
  return testApi;
}

function expandBrowserTestEntries(scenarios, engines) {
  return scenarios.flatMap((scenario) => {
    const scenarioEngines = normalizeBrowserTestEngines(
      scenario.engines || engines
    );
    const skipEngines = normalizeBrowserTestEngines(scenario.skipEngines || []);

    return scenarioEngines.map((engine) => ({
      id: browserTestId(scenario, engine),
      name: formatBrowserTestName(scenario.name, engine),
      scenario,
      engine,
      skipEngine: skipEngines.includes(engine),
    }));
  });
}

function sanitizeArtifactName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function closeBrowserLike(browser) {
  if (browser && typeof browser.close === 'function') {
    return browser.close();
  }
  return Promise.resolve();
}

/**
 * Resolve the timing history path. When a tests directory exists, the history
 * file is placed there so scheduling data stays near the tests that use it.
 */
export function resolveDefaultTimingsFile(options = {}) {
  const { cwd = process.cwd(), testsDirectory = 'tests' } = options;
  const testsPath = path.join(cwd, testsDirectory);
  const parent = existsSync(testsPath) ? testsPath : cwd;
  return path.join(parent, DEFAULT_TIMINGS_FILENAME);
}

/**
 * Normalize a browser engine list and validate unsupported engines early.
 */
export function normalizeBrowserTestEngines(engines) {
  const list =
    engines === undefined
      ? SUPPORTED_BROWSER_TEST_ENGINES
      : Array.isArray(engines)
        ? engines
        : [engines];

  const normalized = list.map((engine) => {
    if (typeof engine !== 'string') {
      throw new Error('Browser test engine names must be strings');
    }
    return engine.toLowerCase();
  });

  for (const engine of normalized) {
    if (!SUPPORTED_BROWSER_TEST_ENGINES.includes(engine)) {
      throw new Error(
        `Unsupported browser test engine "${engine}". Expected one of: ${SUPPORTED_BROWSER_TEST_ENGINES.join(', ')}`
      );
    }
  }

  return normalized;
}

/**
 * Load browser test timing history from disk.
 */
export function loadTimingData(options = {}) {
  const { filePath = resolveDefaultTimingsFile() } = options;

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (parsed.version !== TIMING_DATA_VERSION || !parsed.tests) {
      return createEmptyTimingData();
    }
    return sortedTimingData(parsed);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return createEmptyTimingData();
    }
    throw new Error(
      `Could not read browser test timing data: ${error.message}`
    );
  }
}

/**
 * Save browser test timing history to disk.
 */
export function saveTimingData(data, options = {}) {
  const { filePath = resolveDefaultTimingsFile() } = options;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(sortedTimingData(data), null, 2)}\n`
  );
}

/**
 * Update a test's cumulative average duration.
 */
export function updateTimingData(timingData, result) {
  const { testId, durationMs, now = new Date() } = result;

  if (!testId) {
    throw new Error('testId is required when updating timing data');
  }
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error('durationMs must be a non-negative finite number');
  }

  const previous = timingData.tests?.[testId];
  const runs = (previous?.runs || 0) + 1;
  const previousTotal = (previous?.averageMs || 0) * (previous?.runs || 0);
  const averageMs = Math.round((previousTotal + durationMs) / runs);

  return sortedTimingData({
    ...timingData,
    updatedAt: nowIso(now),
    tests: {
      ...(timingData.tests || {}),
      [testId]: {
        averageMs,
        runs,
        lastMs: Math.round(durationMs),
        updatedAt: nowIso(now),
      },
    },
  });
}

/**
 * Record one test duration to the timing history file.
 */
export function recordTestDuration(result, options = {}) {
  const { filePath = resolveDefaultTimingsFile() } = options;
  const timingData = loadTimingData({ filePath });
  const updated = updateTimingData(timingData, result);
  saveTimingData(updated, { filePath });
  return updated;
}

/**
 * Sort tests so historically slow tests are registered first.
 */
export function orderTestsByHistoricalDuration(
  tests,
  timingData = createEmptyTimingData()
) {
  return tests
    .map((testEntry, index) => ({
      testEntry,
      index,
      durationMs: historicalDurationMs(testEntry, timingData),
    }))
    .sort((a, b) => b.durationMs - a.durationMs || a.index - b.index)
    .map(({ testEntry }) => testEntry);
}

/**
 * Parse shard strings in the Playwright-style "1/3" format.
 */
export function parseShard(shard) {
  if (!shard) {
    return null;
  }

  if (typeof shard === 'object') {
    const { index, total } = shard;
    return validateShard({ index: Number(index), total: Number(total) });
  }

  const match = String(shard).match(/^(\d+)\/(\d+)$/);
  if (!match) {
    throw new Error('Shard must use the "1/3" format');
  }

  return validateShard({
    index: Number(match[1]),
    total: Number(match[2]),
  });
}

function validateShard(shard) {
  const { index, total } = shard;
  if (!Number.isInteger(index) || !Number.isInteger(total) || total < 1) {
    throw new Error('Shard index and total must be positive integers');
  }
  if (index < 1 || index > total) {
    throw new Error('Shard index must be between 1 and shard total');
  }
  return {
    index,
    total,
    zeroBasedIndex: index - 1,
  };
}

/**
 * Build balanced shards with a longest-processing-time-first schedule.
 */
export function planTestShards(tests, options = {}) {
  const { shardCount, timingData = createEmptyTimingData() } = options;

  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error('shardCount must be a positive integer');
  }

  const shards = Array.from({ length: shardCount }, (_, index) => ({
    index: index + 1,
    totalDurationMs: 0,
    tests: [],
  }));

  for (const testEntry of orderTestsByHistoricalDuration(tests, timingData)) {
    shards.sort(
      (a, b) => a.totalDurationMs - b.totalDurationMs || a.index - b.index
    );
    const durationMs = historicalDurationMs(testEntry, timingData);
    shards[0].tests.push(testEntry);
    shards[0].totalDurationMs += durationMs;
  }

  return shards.sort((a, b) => a.index - b.index);
}

/**
 * Order tests, then optionally select the current shard.
 */
export function selectTestsForShard(tests, options = {}) {
  const {
    shard = process.env.BROWSER_COMMANDER_TEST_SHARD,
    timingData = createEmptyTimingData(),
  } = options;
  const parsedShard = parseShard(shard);

  if (!parsedShard) {
    return orderTestsByHistoricalDuration(tests, timingData);
  }

  return planTestShards(tests, {
    shardCount: parsedShard.total,
    timingData,
  })[parsedShard.zeroBasedIndex].tests;
}

/**
 * Create a browser, page, and commander fixture for one engine.
 */
export async function createBrowserFixture(options = {}) {
  const {
    engine = 'playwright',
    launchOptions = {},
    commanderOptions = {},
    launch = launchBrowser,
    makeCommander = makeBrowserCommander,
  } = options;

  const normalizedEngine = normalizeBrowserTestEngines(engine)[0];
  const launched = await launch({
    ...launchOptions,
    engine: normalizedEngine,
  });
  const { browser, page } = launched;

  try {
    const commander = makeCommander({
      page,
      ...commanderOptions,
    });

    return {
      engine: normalizedEngine,
      browser,
      page,
      commander,
      async close() {
        if (typeof commander.destroy === 'function') {
          await commander.destroy();
        }
        await closeBrowserLike(browser);
      },
    };
  } catch (error) {
    await closeBrowserLike(browser);
    throw error;
  }
}

/**
 * Run a callback with a browser fixture and always clean it up.
 */
export async function withBrowserCommander(options, fn) {
  const fixture = await createBrowserFixture(options);
  try {
    return await fn(fixture);
  } finally {
    await fixture.close();
  }
}

/**
 * Run a function with a hard timeout.
 */
export async function runWithTimeout(fn, options = {}) {
  const { timeoutMs, testId = 'browser test' } = options;

  if (!timeoutMs) {
    return fn();
  }

  let timeoutId;
  try {
    return await Promise.race([
      fn(),
      new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Timeout of ${timeoutMs}ms exceeded for ${testId}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retry a failing operation.
 */
export async function runWithRetries(fn, options = {}) {
  const { retries = 0, testId = 'browser test', onRetry } = options;
  let lastError;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn({ attempt });
    } catch (error) {
      lastError = error;
      if (attempt > retries) {
        break;
      }
      if (onRetry) {
        await onRetry({
          testId,
          attempt,
          nextAttempt: attempt + 1,
          error,
        });
      }
    }
  }

  throw lastError;
}

/**
 * Write failure metadata and a screenshot when the page supports it.
 */
export async function writeFailureArtifacts(options = {}) {
  const {
    page,
    error,
    testId,
    engine,
    artifactsDir = DEFAULT_ARTIFACTS_DIR,
  } = options;

  if (!artifactsDir) {
    return [];
  }

  mkdirSync(artifactsDir, { recursive: true });
  const safeName = sanitizeArtifactName(`${testId}-${engine}`);
  const errorPath = path.join(artifactsDir, `${safeName}.error.json`);
  const artifacts = [errorPath];

  writeFileSync(
    errorPath,
    `${JSON.stringify(
      {
        testId,
        engine,
        message: error?.message || String(error),
        stack: error?.stack || null,
      },
      null,
      2
    )}\n`
  );

  if (page && typeof page.screenshot === 'function') {
    const screenshotPath = path.join(artifactsDir, `${safeName}.png`);
    try {
      await page.screenshot({ path: screenshotPath });
      artifacts.push(screenshotPath);
    } catch (screenshotError) {
      const screenshotErrorPath = path.join(
        artifactsDir,
        `${safeName}.screenshot-error.txt`
      );
      writeFileSync(screenshotErrorPath, `${screenshotError.message}\n`);
      artifacts.push(screenshotErrorPath);
    }
  }

  return artifacts;
}

/**
 * Run one browser scenario without registering it with test-anywhere.
 */
export function runBrowserScenario(scenario, options = {}) {
  const normalizedScenario = normalizeScenario(scenario);
  const {
    engine = 'playwright',
    launchOptions = {},
    commanderOptions = {},
    launch,
    makeCommander,
    artifactsDir = DEFAULT_ARTIFACTS_DIR,
    timeoutMs,
    attempt = 1,
  } = options;
  const testId = browserTestId(normalizedScenario, engine);

  return withBrowserCommander(
    {
      engine,
      launch,
      makeCommander,
      launchOptions: mergeOptions(
        launchOptions,
        normalizedScenario.launchOptions
      ),
      commanderOptions: mergeOptions(
        commanderOptions,
        normalizedScenario.commanderOptions
      ),
    },
    async (fixture) => {
      try {
        return await runWithTimeout(
          () =>
            normalizedScenario.fn({
              ...fixture,
              testInfo: {
                id: testId,
                name: normalizedScenario.name,
                engine,
                attempt,
                tags: normalizedScenario.tags || [],
              },
            }),
          {
            timeoutMs: normalizedScenario.timeoutMs || timeoutMs,
            testId,
          }
        );
      } catch (error) {
        await writeFailureArtifacts({
          page: fixture.page,
          error,
          testId,
          engine,
          artifactsDir: normalizedScenario.artifactsDir ?? artifactsDir,
        });
        throw error;
      }
    }
  );
}

/**
 * Register a matrix of browser scenarios with test-anywhere.
 */
export function defineBrowserTests(scenarios, options = {}) {
  if (!Array.isArray(scenarios)) {
    throw new Error('defineBrowserTests expects an array of scenarios');
  }

  const {
    engines,
    timingFile = resolveDefaultTimingsFile(),
    timingData = loadTimingData({ filePath: timingFile }),
    recordDurations = true,
    order = true,
    shard = process.env.BROWSER_COMMANDER_TEST_SHARD,
    testApi = baseTest,
  } = options;
  const normalizedScenarios = scenarios.map(normalizeScenario);
  const expandedEntries = expandBrowserTestEntries(
    normalizedScenarios,
    engines
  );
  const selectedEntries =
    order === false
      ? expandedEntries
      : selectTestsForShard(expandedEntries, { shard, timingData });
  const registrations = [];

  for (const entry of selectedEntries) {
    const { scenario, engine, skipEngine } = entry;
    const register = registrationForScenario(scenario, skipEngine, testApi);

    register(entry.name, async () => {
      const startedAt = Date.now();
      try {
        await runWithRetries(
          ({ attempt }) =>
            runBrowserScenario(scenario, {
              ...options,
              engine,
              attempt,
              artifactsDir: scenario.artifactsDir ?? options.artifactsDir,
              timeoutMs: scenario.timeoutMs || options.timeoutMs,
            }),
          {
            retries: scenario.retries ?? options.retries ?? 0,
            testId: entry.id,
            onRetry: options.onRetry,
          }
        );
      } finally {
        if (recordDurations && !scenario.todo) {
          recordTestDuration(
            {
              testId: entry.id,
              durationMs: Date.now() - startedAt,
            },
            { filePath: timingFile }
          );
        }
      }
    });

    registrations.push({
      id: entry.id,
      name: entry.name,
      engine,
      skipped: Boolean(scenario.skip || skipEngine),
      todo: Boolean(scenario.todo),
    });
  }

  return registrations;
}

/**
 * Register one browser scenario across Playwright and Puppeteer by default.
 */
export function browserTest(name, fn, options = {}) {
  return defineBrowserTests(
    [
      {
        ...options,
        name,
        fn,
      },
    ],
    {
      ...options,
      order: false,
    }
  );
}
