/**
 * High-level JSON-RPC methods (docs/cli-and-bridge.md, "High-level methods").
 * They mirror the CLI commands and return plain JSON, so the same command
 * script gives the same results in JS, Rust and Python.
 *
 * Every method is `(state, params) => result`, where `state` is the
 * dispatcher state built by `createDispatcher()`.
 */
import path from 'node:path';

import { invalidParams, requireString } from './rpc-error.js';
import {
  buildLaunchOptions,
  resolveEngine,
  sessionFromConnect,
  sessionFromLaunch,
} from './sessions.js';

function sessionOf(state, params) {
  return state.sessions.get(params.session);
}

async function launchSession(state, params) {
  const options = buildLaunchOptions(params);
  const launched = await state.dependencies.launchBrowser(options);
  const session = state.sessions.add(
    sessionFromLaunch(options.engine, launched)
  );
  return {
    session,
    cdpEndpoint: launched.cdpEndpoint ?? null,
    remoteDebuggingPort: launched.remoteDebuggingPort ?? null,
    userDataDir: launched.userDataDir ?? null,
    temporaryProfile: launched.temporaryProfile ?? false,
  };
}

async function connectSession(state, params) {
  const cdpEndpoint = requireString(params, 'cdpEndpoint');
  const engine = resolveEngine(params.engine);
  const connected = await state.dependencies.connectBrowser({
    engine,
    cdpEndpoint,
  });
  const session = state.sessions.add(sessionFromConnect(engine, connected));
  return { session, cdpEndpoint };
}

async function closeSession(state, params) {
  await state.sessions.close(params.session);
  return { closed: true };
}

async function goto(state, params) {
  const { page } = sessionOf(state, params);
  await page.goto(requireString(params, 'url'));
  return { url: page.url(), title: await page.title() };
}

async function click(state, params) {
  const selector = requireString(params, 'selector');
  await sessionOf(state, params).page.click(selector);
  return { clicked: selector };
}

async function fill(state, params) {
  const selector = requireString(params, 'selector');
  const value = params.value === undefined ? '' : String(params.value);
  const { engine, page } = sessionOf(state, params);
  if (engine === 'playwright') {
    await page.fill(selector, value);
  } else {
    await page.locator(selector).fill(value);
  }
  return { filled: selector, value };
}

async function evaluate(state, params) {
  const expression = requireString(params, 'expression');
  const value = await sessionOf(state, params).page.evaluate(expression);
  return { value: value === undefined ? null : value };
}

/** Write to `path` when given, otherwise return the bytes inline. */
async function capture(params, write) {
  if (params.path !== undefined) {
    const target = path.resolve(requireString(params, 'path'));
    const bytes = await write({ path: target });
    return { path: target, bytes: bytes.length };
  }
  const bytes = await write({});
  return { data: { $binary: Buffer.from(bytes).toString('base64') } };
}

function screenshot(state, params) {
  const { page } = sessionOf(state, params);
  return capture(params, (options) =>
    page.screenshot({ ...options, fullPage: params.fullPage === true })
  );
}

function pdf(state, params) {
  const { page } = sessionOf(state, params);
  return capture(params, (options) => page.pdf(options));
}

async function traceStart(state, params) {
  const session = sessionOf(state, params);
  if (session.trace) {
    throw invalidParams('A trace is already recording in this session');
  }
  const output = path.resolve(requireString(params, 'out'));
  session.trace = await state.dependencies.startTrace({
    page: session.page,
    output,
  });
  return { trace: session.trace.path ?? output };
}

async function traceStop(state, params) {
  const session = sessionOf(state, params);
  if (!session.trace) {
    throw invalidParams('No trace is recording in this session');
  }
  const { trace } = session;
  session.trace = null;
  await trace.stop();
  return { trace: trace.path };
}

function cookieKey(cookie) {
  return `${cookie.domain}\t${cookie.path}\t${cookie.name}`;
}

async function readCookies(state, params) {
  const from = requireString(params, 'from');
  const domains = params.domains ?? [];
  if (!Array.isArray(domains)) {
    throw invalidParams('domains must be an array of strings');
  }
  const filters = domains.length > 0 ? domains : [undefined];
  const unique = new Map();
  for (const domainFilter of filters) {
    const cookies = await state.dependencies.readBrowserCookies({
      browser: from,
      profile: params.profile,
      domainFilter,
      ignoreDecryptionErrors: true,
    });
    for (const cookie of cookies) {
      unique.set(cookieKey(cookie), cookie);
    }
  }
  return [...unique.values()];
}

function cookieAdder({ engine, context, page }) {
  return engine === 'playwright'
    ? (cookies) => context.addCookies(cookies)
    : (cookies) => page.setCookie(...cookies);
}

/**
 * Import cookies from an installed browser profile into the session. A batch
 * that the engine rejects is retried one cookie at a time, so one malformed
 * cookie is reported in `skipped` instead of failing the whole import.
 */
async function importCookies(state, params) {
  const session = sessionOf(state, params);
  const cookies = await readCookies(state, params);
  const add = cookieAdder(session);
  if (cookies.length === 0) {
    return { imported: 0, skipped: [] };
  }
  try {
    await add(cookies);
    return { imported: cookies.length, skipped: [] };
  } catch {
    const skipped = [];
    for (const cookie of cookies) {
      await add([cookie]).catch((error) =>
        skipped.push({
          item: `${cookie.domain} ${cookie.name}`,
          reason: error.message,
        })
      );
    }
    return { imported: cookies.length - skipped.length, skipped };
  }
}

function migrateProfile(state, params) {
  return state.dependencies.migrateProfile({
    from: params.from,
    profile: params.profile,
    to: params.to,
    include: params.include,
    domains: params.domains,
  });
}

async function open(state, params) {
  const url = requireString(params, 'url');
  const result = await state.dependencies.openInUserBrowser(url);
  return result && typeof result === 'object' ? result : { opened: url };
}

/** `measureParity()` takes launch options: engine, channel, executablePath… */
function doctor(state, params) {
  return state.dependencies.measureParity(buildLaunchOptions(params));
}

function version(state) {
  return state.dependencies.packageInfo();
}

/** Method name to implementation. */
export const HIGH_LEVEL_METHODS = Object.freeze({
  'session.launch': launchSession,
  'session.connect': connectSession,
  'session.close': closeSession,
  'page.goto': goto,
  'page.click': click,
  'page.fill': fill,
  'page.eval': evaluate,
  'page.screenshot': screenshot,
  'page.pdf': pdf,
  'trace.start': traceStart,
  'trace.stop': traceStop,
  'cookies.import': importCookies,
  'profile.migrate': migrateProfile,
  open,
  doctor,
  version,
});
