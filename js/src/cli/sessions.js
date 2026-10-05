/**
 * Browser sessions owned by one `serve --stdio` or `run` dispatcher
 * (issue #104). A session is a launched or attached browser with the engine
 * objects behind it: `browser`, `context` and the `page` commands act on.
 */
import { invalidParams } from './rpc-error.js';

/** `--browser` names mapped to installed-browser channels. */
export const BROWSER_CHANNELS = Object.freeze({
  chrome: 'chrome',
  edge: 'msedge',
  msedge: 'msedge',
  brave: 'brave',
  chromium: 'chromium',
});

const ENGINES = Object.freeze(['playwright', 'puppeteer', 'selenium']);

/**
 * Launch options that are forwarded to `launchBrowser()` as they are, so the
 * bridge can express everything the old Rust bridge's `launch` operation did.
 */
const LAUNCH_PASSTHROUGH = Object.freeze([
  'args',
  'extraArgs',
  'ignoreDefaultArgs',
  'slowMo',
  'colorScheme',
  'channel',
  'storageState',
  'fingerprint',
  'remoteDebuggingPort',
  'automationParity',
  'env',
  'startupTimeout',
  'attach',
  'preferences',
  'localState',
  'defaultBrowserCheck',
  'firstRun',
  'driverPath',
  'bidi',
]);

/** Validate an engine name, defaulting to Playwright. */
export function resolveEngine(engine = 'playwright') {
  if (!ENGINES.includes(engine)) {
    throw invalidParams(
      `Unsupported engine "${engine}"; expected ${ENGINES.join(' or ')}`
    );
  }
  return engine;
}

function resolveChannel(browser) {
  if (browser === undefined) {
    return undefined;
  }
  const channel = BROWSER_CHANNELS[browser];
  if (!channel) {
    throw invalidParams(
      `Unsupported browser "${browser}"; expected chrome, edge, brave or chromium`
    );
  }
  return channel;
}

function assertStringList(value, name) {
  if (
    value !== undefined &&
    (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
  ) {
    throw invalidParams(`${name} must be an array of strings`);
  }
}

/**
 * Translate `session.launch` params into `launchBrowser()` options.
 *
 * @param {Object} params - JSON-RPC params
 * @returns {Object} launchBrowser options
 */
export function buildLaunchOptions(params = {}) {
  assertStringList(params.restrictions, 'restrictions');
  assertStringList(params.args, 'args');
  const options = {
    engine: resolveEngine(params.engine),
    headless: params.headless === true,
  };
  const channel =
    options.engine === 'selenium' ? undefined : resolveChannel(params.browser);
  const defined = {
    launch: params.launch,
    executablePath: params.executablePath,
    userDataDir: params.userDataDir,
    restrictions: params.restrictions,
    channel,
    ...(options.engine === 'selenium' && params.browser !== undefined
      ? { browser: params.browser }
      : {}),
  };
  for (const name of LAUNCH_PASSTHROUGH) {
    defined[name] ??= params[name];
  }
  for (const [key, value] of Object.entries(defined)) {
    if (value !== undefined) {
      options[key] = value;
    }
  }
  return options;
}

/**
 * Build a session from a `launchBrowser()` result.
 *
 * Playwright's real launch returns the default context as `browser` and the
 * CDP-connected `Browser` as `connectedBrowser`; the engine launch returns a
 * persistent context whose `browser()` is null. Puppeteer returns a Browser.
 */
export function sessionFromLaunch(engine, launched) {
  const playwright = engine === 'playwright';
  const handle = launched.browser;
  return {
    engine,
    browser: playwright
      ? (launched.connectedBrowser ?? handle?.browser?.() ?? null)
      : handle,
    context: playwright ? handle : (handle?.defaultBrowserContext?.() ?? null),
    page: launched.page,
    driver: launched.driver ?? (engine === 'selenium' ? handle : null),
    args: launched.args ?? [],
    close: () => launched.close(),
    connected: false,
  };
}

/**
 * Build a session from a `connectBrowser()` result. Closing it only
 * disconnects: the browser keeps running for the next command.
 */
export function sessionFromConnect(engine, connected) {
  const { browser, page } = connected;
  const playwright = engine === 'playwright';
  return {
    engine,
    browser,
    context: playwright
      ? (page?.context?.() ?? null)
      : (browser?.defaultBrowserContext?.() ?? null),
    page,
    driver: connected.driver ?? null,
    // Playwright's close() on a connectOverCDP browser disconnects;
    // Puppeteer's close() would quit the browser, disconnect() does not.
    close: async () => {
      await connected.downloads?.dispose?.();
      if (engine === 'selenium') {
        await connected.close();
        return;
      }
      await (playwright ? browser.close() : browser.disconnect());
    },
    connected: true,
  };
}

/** Sessions with deterministic ids `s1`, `s2`, … */
export class SessionTable {
  constructor() {
    this.nextId = 1;
    this.sessions = new Map();
    this.latest = null;
  }

  /** Add a session and return its id. */
  add(session) {
    const id = `s${this.nextId++}`;
    this.sessions.set(id, session);
    this.latest = id;
    return id;
  }

  /** The session behind an id (or the latest one when omitted). */
  get(id) {
    const resolved = id ?? this.latest;
    const session = resolved ? this.sessions.get(resolved) : undefined;
    if (!session) {
      throw invalidParams(
        id ? `Unknown session: ${id}` : 'No session; call session.launch first'
      );
    }
    return session;
  }

  /** Close one session and forget it. */
  async close(id) {
    const resolved = id ?? this.latest;
    const session = this.get(resolved);
    this.sessions.delete(resolved);
    if (this.latest === resolved) {
      this.latest = [...this.sessions.keys()].at(-1) ?? null;
    }
    await session.trace?.stop?.().catch(() => {});
    await session.close();
  }

  /** Close every session, ignoring individual failures. */
  async closeAll() {
    const ids = [...this.sessions.keys()];
    await Promise.all(ids.map((id) => this.close(id).catch(() => {})));
  }
}
