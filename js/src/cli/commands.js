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
    const opened = options.cdpEndpoint
      ? await dispatcher.dispatch('session.connect', {
          cdpEndpoint: options.cdpEndpoint,
          engine: options.engine,
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
    if (!parsed.options.keepOpen) {
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
      to: options.to,
      include: options.include
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      domains: options.domain,
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
    path: args.path,
    fullPage: options.fullPage === true,
  })),
  pdf: pageCommand('page.pdf', ({ args }) => ({ path: args.path })),
  'trace start': traceStart,
  'trace stop': traceStop,
  'trace view': traceView,
  'cookies import': pageCommand('cookies.import', ({ options }) => ({
    from: requireOption(options, 'from', 'cookies import'),
    profile: options.profile,
    domains: options.domain,
  })),
  'profile migrate': profileMigrate,
  'profile snapshot': profileSnapshot,
  attach,
  doctor,
  run,
  serve,
});
