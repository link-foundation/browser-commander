/**
 * The `browser-commander` commands (docs/cli-and-bridge.md, "Commands").
 *
 * Page commands run through the same dispatcher as `serve --stdio`: open a
 * session (attach with `--cdp-endpoint`, or launch a temporary browser), run
 * one high-level method, and close the session again.
 *
 * Every command is `(parsed, io) => {document, exitCode}`. A command that
 * prints its document early (`launch --keep-open`) returns `document: null`.
 */
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  integerOption,
  launchAttachParams,
  launchParams,
  requireOption,
  UsageError,
} from './args.js';
import { createDispatcher } from './dispatcher.js';
import { DEFAULT_DEPENDENCIES } from './modules.js';
import { runScript } from './script.js';
import { serveStdio } from './serve.js';
import { encodeAnimation } from '../capture/index.js';
import { renderTrace, summarizeTrace } from '../traces/render.js';

function mediaOptions(options) {
  const result = { ...options };
  for (const key of [
    'quality',
    'fps',
    'loop',
    'palette',
    'maxFrames',
    'maxBytes',
    'maxDurationMs',
  ]) {
    if (options[key] !== undefined) {
      result[key] = Number(options[key]);
    }
  }
  if (
    options.scale !== undefined &&
    !['css', 'device'].includes(options.scale)
  ) {
    result.scale = Number(options.scale);
  }
  for (const key of ['clip', 'size']) {
    if (options[key]) {
      try {
        result[key] = JSON.parse(options[key]);
      } catch {
        throw new UsageError(`${key} must be a JSON object`);
      }
    }
  }
  return result;
}

async function gif(parsed) {
  const target = path.resolve(requireOption(parsed.options, 'out', 'gif'));
  const bytes = await encodeAnimation(parsed.options.frame ?? [], {
    ...mediaOptions(parsed.options),
    path: target,
  });
  return done({ path: target, bytes: bytes.length });
}
async function traceSummarize(parsed) {
  return done(await summarizeTrace(parsed.args.dir, parsed.options));
}
async function traceRender(parsed) {
  const target = path.resolve(
    requireOption(parsed.options, 'out', 'trace render')
  );
  const options = { ...mediaOptions(parsed.options), path: target };
  let browser;
  try {
    if (
      ['webm', 'mp4', 'mov'].includes(
        options.format ?? path.extname(target).slice(1)
      ) &&
      !options.ffmpeg
    ) {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: true });
      options.page = await browser.newPage();
    }
    const bytes = await renderTrace(parsed.args.dir, options);
    return done({ path: target, bytes: bytes.length });
  } finally {
    await browser?.close();
  }
}
function recordStart(parsed, io) {
  const target = path.resolve(
    requireOption(parsed.options, 'out', 'record start')
  );
  const marker = `${target}.stop`;
  return withPageSession(parsed, io, async (session, dispatcher) => {
    await rm(marker, { force: true });
    await dispatcher.dispatch('record.start', {
      session,
      ...mediaOptions(parsed.options),
      format: parsed.options.format ?? path.extname(target).slice(1),
      path: target,
    });
    let stopped = false;
    try {
      io.print({ recording: target });
      await waitForStop({
        signals: io.signals,
        extra: [markerAppears(marker, () => stopped)],
      });
      return done(await dispatcher.dispatch('record.stop', { session }));
    } finally {
      stopped = true;
      await rm(marker, { force: true });
    }
  });
}
async function recordStop(parsed) {
  const target = path.resolve(
    requireOption(parsed.options, 'out', 'record stop')
  );
  await writeFile(`${target}.stop`, '', { mode: 0o600 });
  return done({ recording: target, stopRequested: true });
}

/** Where `trace stop` asks a running `trace start` to finish. */
export const TRACE_STOP_MARKER = '.stop';

const TRACE_POLL_MS = 250;

function done(document, exitCode = 0) {
  return { document, exitCode };
}

/**
 * Resolve once any stop source fires: SIGINT/SIGTERM, the end of stdin when
 * `stdin` is given, or any of the `extra` promises.
 */
export function waitForStop({ signals, stdin, extra = [] }) {
  return new Promise((resolve) => {
    const cleanups = [];
    const finish = () => {
      cleanups.forEach((cleanup) => cleanup());
      resolve();
    };
    const listen = (emitter, event) => {
      emitter.once(event, finish);
      cleanups.push(() => emitter.off(event, finish));
    };
    listen(signals, 'SIGINT');
    listen(signals, 'SIGTERM');
    if (stdin) {
      listen(stdin, 'end');
      listen(stdin, 'close');
      stdin.resume?.();
    }
    extra.forEach((promise) => promise.then(finish, finish));
  });
}

/** Resolve when the browser goes away (the user closed the window). */
function browserGone(session) {
  const { browser } = session;
  if (typeof browser?.once !== 'function') {
    return new Promise(() => {});
  }
  return new Promise((resolve) => browser.once('disconnected', resolve));
}

/**
 * Open a session for a page command, run `work(sessionId, dispatcher)`, and
 * close the session (a connected browser keeps running).
 */
async function withPageSession(parsed, io, work, { skipUrl = false } = {}) {
  const { options } = parsed;
  const dispatcher = createDispatcher({ dependencies: io.dependencies });
  try {
    const opened =
      options.cdpEndpoint || options.serverUrl
        ? await dispatcher.dispatch('session.connect', {
            cdpEndpoint: options.cdpEndpoint,
            engine: options.engine,
            targetId: options.targetId,
            singleTab: options.singleTab,
            ...(options.serverUrl ? { serverUrl: options.serverUrl } : {}),
            ...(options.driverPath ? { driverPath: options.driverPath } : {}),
            ...(options.bidi !== undefined ? { bidi: options.bidi } : {}),
          })
        : await dispatcher.dispatch('session.launch', launchParams(options));
    if (options.url && !skipUrl) {
      await dispatcher.dispatch('page.goto', {
        session: opened.session,
        url: options.url,
      });
    }
    return await work(opened.session, dispatcher);
  } finally {
    await dispatcher.close();
  }
}

function pageCommand(method, paramsOf, { skipUrl = false } = {}) {
  return (parsed, io) => {
    // Params are read first, so a usage error never starts a browser.
    const params = paramsOf(parsed);
    return withPageSession(
      parsed,
      io,
      async (session, dispatcher) =>
        done(await dispatcher.dispatch(method, { session, ...params })),
      { skipUrl }
    );
  };
}

async function dispatchOnce(io, method, params = {}) {
  const dispatcher = createDispatcher({ dependencies: io.dependencies });
  try {
    return await dispatcher.dispatch(method, params);
  } finally {
    await dispatcher.close();
  }
}

async function version(parsed, io) {
  return done(await dispatchOnce(io, 'version'));
}

/**
 * Launch a browser and print its endpoint. Without `--keep-open` the browser
 * is closed right after printing, which is only useful to check a launch.
 */
async function launch(parsed, io) {
  const attach = launchAttachParams(parsed.options);
  const dispatcher = createDispatcher({ dependencies: io.dependencies });
  try {
    const opened = await dispatcher.dispatch('session.launch', {
      ...launchParams(parsed.options),
      ...(attach ? { attach } : {}),
    });
    const session = dispatcher.state.sessions.get(opened.session);
    const document = {
      cdpEndpoint: opened.cdpEndpoint,
      remoteDebuggingPort: opened.remoteDebuggingPort,
      userDataDir: opened.userDataDir,
      temporaryProfile: opened.temporaryProfile,
      args: session.args,
      ...(opened.attach ? { attach: opened.attach } : {}),
    };
    if (!parsed.options.keepOpen || session.persistent) {
      return done(document);
    }
    io.print(document);
    await waitForStop({
      signals: io.signals,
      stdin: io.stdin,
      extra: [browserGone(session)],
    });
    return done(null);
  } finally {
    await dispatcher.close();
  }
}

async function open(parsed, io) {
  return done(await dispatchOnce(io, 'open', { url: parsed.args.url }));
}

async function markerAppears(marker, stopped) {
  while (!stopped()) {
    if (await stat(marker).catch(() => null)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, TRACE_POLL_MS));
  }
}

/** Record until `trace stop --out DIR` writes the marker, or SIGINT. */
function traceStart(parsed, io) {
  const out = path.resolve(requireOption(parsed.options, 'out', 'trace start'));
  const marker = path.join(out, TRACE_STOP_MARKER);
  return withPageSession(parsed, io, async (session, dispatcher) => {
    await rm(marker, { force: true });
    const { trace } = await dispatcher.dispatch('trace.start', {
      session,
      out,
    });
    let stopped = false;
    await waitForStop({
      signals: io.signals,
      extra: [markerAppears(marker, () => stopped)],
    });
    stopped = true;
    await rm(marker, { force: true });
    await dispatcher.dispatch('trace.stop', { session });
    return done({ trace, stopped: true });
  });
}

async function traceStop(parsed) {
  const out = path.resolve(requireOption(parsed.options, 'out', 'trace stop'));
  await writeFile(path.join(out, TRACE_STOP_MARKER), '');
  return done({ trace: out, stopRequested: true });
}

async function traceView(parsed, io) {
  const bundle = path.resolve(parsed.args.dir);
  const output = parsed.options.out && path.resolve(parsed.options.out);
  const { writeTraceViewer } = { ...DEFAULT_DEPENDENCIES, ...io.dependencies };
  return done({ viewer: await writeTraceViewer(bundle, output) });
}

async function profileMigrate(parsed, io) {
  const { options } = parsed;
  return done(
    await dispatchOnce(io, 'profile.migrate', {
      from: requireOption(options, 'from', 'profile migrate'),
      profile: options.profile,
      userDataDir: options.userDataDir,
      targetBrowser: options.targetBrowser,
      passwordCsv: options.passwordCsv,
      includePaymentCards: options.includePaymentCards,
      to: options.to,
      include: options.include
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      domains: options.domain,
    })
  );
}

/**
 * List the installed browser profiles that hold cookies (names and counts
 * only, never values), optionally filtered and counted by `--domain`.
 */
async function cookieSources(parsed, io) {
  const { options } = parsed;
  return done(
    await dispatchOnce(io, 'cookies.sources', {
      domains: options.domain,
    })
  );
}

/** List installed browser profiles, optionally for one `--browser`. */
async function profileSources(parsed, io) {
  const { options } = parsed;
  return done(
    await dispatchOnce(io, 'profile.sources', {
      browser: options.browser,
    })
  );
}

/** Copy a real profile into `--to` (or a new temporary directory). */
async function profileSnapshot(parsed, io) {
  const { options } = parsed;
  return done(
    await dispatchOnce(io, 'profile.snapshot', {
      from: requireOption(options, 'from', 'profile snapshot'),
      profile: options.profile,
      to: options.to && path.resolve(options.to),
    })
  );
}

/**
 * Wait for the companion extension, print its tabs, and close the relay.
 * `serve --stdio` keeps the relay open instead (`attach` ... `attach.close`).
 */
async function attach(parsed, io) {
  const { options } = parsed;
  const mode = requireOption(options, 'mode', 'attach');
  if (mode !== 'extension') {
    throw new UsageError(
      `attach: --mode supports "extension", got "${mode}"; use launch --attach snapshot or open <url> for the other modes`
    );
  }
  const params = { mode };
  const port = integerOption(options, 'port', 'attach');
  const timeoutMs = integerOption(options, 'timeout', 'attach');
  if (port !== undefined) {
    params.port = port;
  }
  if (timeoutMs !== undefined) {
    params.timeoutMs = timeoutMs;
  }
  return done(await dispatchOnce(io, 'attach', params));
}

/** Exit 2 when the report has a difference not listed in limitations.json. */
async function doctor(parsed, io) {
  const report = await dispatchOnce(io, 'doctor', launchParams(parsed.options));
  const unlisted = report?.ok === false || report?.unlisted?.length > 0;
  return done(report, unlisted ? 2 : 0);
}

async function run(parsed, io) {
  const scriptPath = path.resolve(parsed.args.script);
  let script;
  try {
    script = JSON.parse(await readFile(scriptPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${scriptPath}: ${error.message}`, {
      cause: error,
    });
  }
  const { results, failed } = await runScript(script, {
    dependencies: io.dependencies,
    launchDefaults: launchParams(parsed.options),
  });
  return done({ results }, failed ? 1 : 0);
}

async function serve(parsed, io) {
  if (!parsed.options.stdio) {
    throw new UsageError('serve requires --stdio');
  }
  await serveStdio({
    input: io.stdin,
    write: io.write,
    dependencies: io.dependencies,
  });
  return done(null);
}

/** Command name to implementation. */
export const COMMAND_HANDLERS = Object.freeze({
  version,
  launch,
  open,
  goto: pageCommand('page.goto', ({ args }) => ({ url: args.url }), {
    skipUrl: true,
  }),
  click: pageCommand('page.click', ({ args }) => ({
    selector: args.selector,
  })),
  fill: pageCommand('page.fill', ({ args }) => ({
    selector: args.selector,
    value: args.value,
  })),
  eval: pageCommand('page.eval', ({ args }) => ({
    expression: args.expression,
  })),
  screenshot: pageCommand('page.screenshot', ({ args, options }) => ({
    ...mediaOptions(options),
    path: args.path,
  })),
  pdf: pageCommand('page.pdf', ({ args }) => ({ path: args.path })),
  'trace start': traceStart,
  'trace stop': traceStop,
  'trace view': traceView,
  'trace summarize': traceSummarize,
  'trace render': traceRender,
  'record start': recordStart,
  'record stop': recordStop,
  gif,
  'cookies import': pageCommand('cookies.import', ({ options }) => ({
    from: requireOption(options, 'from', 'cookies import'),
    profile: options.profile,
    domains: options.domain,
  })),
  'cookies sources': cookieSources,
  'profile migrate': profileMigrate,
  'profile snapshot': profileSnapshot,
  'profile sources': profileSources,
  attach,
  doctor,
  run,
  serve,
});
