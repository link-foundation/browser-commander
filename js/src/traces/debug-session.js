import fs from 'node:fs/promises';
import { startTrace } from './recorder.js';
import { prepareDebugOutput, validateDebugConfig } from './debug-output.js';

const sessions = new WeakMap();
const disabledPages = new WeakSet();

export function debugEnabled(options = {}) {
  if (options.debug === false || process.env.BROWSER_COMMANDER_DEBUG === '0') {
    return false;
  }
  if (options.debug === undefined && disabledPages.has(options.page)) {
    return false;
  }
  return (
    options.debug === true ||
    (options.debug !== null && typeof options.debug === 'object') ||
    (options.debug === undefined &&
      (sessions.has(options.page) ||
        process.env.BROWSER_COMMANDER_DEBUG === '1'))
  );
}

/** A launched page and its commander share one recording and one output path. */
export async function ensureDebugSession(options) {
  const { page, commander } = options;
  const existing = sessions.get(page);
  if (!debugEnabled(options)) {
    if (options.debug === false) {
      disabledPages.add(page);
    }
    await existing?.stop();
    return null;
  }
  disabledPages.delete(page);
  let session = existing;
  if (!session) {
    const config =
      options.debug && typeof options.debug === 'object' ? options.debug : {};
    validateDebugConfig(config);
    session = { path: null, owned: false };
    sessions.set(page, session);
    let timer;
    session.ready = prepareDebugOutput(options, config)
      .then(async (prepared) => {
        session.path = prepared.output;
        session.owned = prepared.owned;
        const trace = await startTrace({
          ...prepared.traceOptions,
          output: prepared.output,
          page,
          commander: commander ?? {
            page,
            engine: options.engine,
            downloads: options.downloads,
          },
          checkpointOnNavigation: config.checkpointOnNavigation ?? true,
        });
        console.error(
          `[browser-commander] Recording session to ${session.path}`
        );
        if (prepared.maxDurationMs) {
          timer = setTimeout(() => {
            session
              .stop()
              .catch((error) =>
                console.warn(
                  `[browser-commander] Could not finish recording: ${error.message}`
                )
              );
          }, prepared.maxDurationMs);
          timer.unref?.();
        }
        return trace;
      })
      .catch(async (error) => {
        sessions.delete(page);
        if (session.owned) {
          await fs.rm(session.path, { recursive: true, force: true });
        }
        console.warn(
          `[browser-commander] Could not start recording: ${error.message}`
        );
        return null;
      });
    let stopping;
    session.stop = (stopOptions = {}) => {
      const discard = stopOptions.discard ?? config.retain === false;
      if (discard && !session.owned && session.path) {
        return Promise.reject(
          new Error('Only a managed debug directory can be discarded')
        );
      }
      return (stopping ??= session.ready.then(async (trace) => {
        if (discard && trace && !session.owned) {
          throw new Error('Only a managed debug directory can be discarded');
        }
        clearTimeout(timer);
        disabledPages.add(page);
        try {
          return await trace?.stop({ ...stopOptions, discard });
        } finally {
          if (sessions.get(page) === session) {
            sessions.delete(page);
          }
          if (discard && session.owned) {
            await fs.rm(session.path, { recursive: true, force: true });
          }
        }
      }));
    };
  }
  const trace = await session.ready;
  if (!trace) {
    return null;
  }
  if (commander) {
    trace.attachCommander(commander);
  }
  return session;
}

/** Finish trace files before closing/detaching the engine that supplies them. */
export async function attachLaunchDebug(result, options) {
  const session = await ensureDebugSession({
    ...options,
    engine:
      options.engine ??
      (result.page.isWebDriverPage ? 'selenium' : 'playwright'),
    page: result.page,
    downloads: result.downloads,
  });
  result.tracePath = session?.path ?? null;
  result.stopDebug = (options) =>
    session?.stop(options) ?? Promise.resolve(null);
  if (!session) {
    return result;
  }
  const wrap = (owner, name) => {
    const method = owner?.[name];
    if (typeof method !== 'function') {
      return;
    }
    owner[name] = async (...args) => {
      let result;
      try {
        await session.stop();
      } finally {
        result = await method.apply(owner, args);
      }
      return result;
    };
  };
  wrap(result, 'close');
  wrap(result, 'detach');
  wrap(result.browser, 'close');
  wrap(result.browser, 'disconnect');
  return result;
}
