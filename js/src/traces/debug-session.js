import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTrace } from './recorder.js';

const sessions = new WeakMap();
const disabledPages = new WeakSet();

export function debugEnabled(options = {}) {
  return (
    options.debug !== false &&
    process.env.BROWSER_COMMANDER_DEBUG !== '0' &&
    !(options.debug === undefined && disabledPages.has(options.page))
  );
}

/** A launched page and its commander share one recording and one output path. */
export async function ensureDebugSession(options) {
  const { page, commander } = options;
  const existing = sessions.get(page);
  if (!debugEnabled(options)) {
    disabledPages.add(page);
    await existing?.stop();
    return null;
  }
  disabledPages.delete(page);
  let session = existing;
  if (!session) {
    const config =
      options.debug && typeof options.debug === 'object' ? options.debug : {};
    const output = path.resolve(
      config.output ??
        options.output ??
        process.env.BROWSER_COMMANDER_TRACE ??
        path.join(
          'browser-commander-traces',
          `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}-${randomUUID().slice(0, 8)}`
        )
    );
    session = { path: output };
    sessions.set(page, session);
    session.ready = startTrace({
      ...config,
      output,
      page,
      commander: commander ?? {
        page,
        engine: options.engine,
        downloads: options.downloads,
      },
      checkpointOnNavigation: config.checkpointOnNavigation ?? true,
    })
      .then((trace) => {
        console.error(`[browser-commander] Recording session to ${output}`);
        return trace;
      })
      .catch((error) => {
        sessions.delete(page);
        console.warn(
          `[browser-commander] Could not start recording: ${error.message}`
        );
        return null;
      });
    let stopping;
    session.stop = () =>
      (stopping ??= session.ready.then(async (trace) => {
        try {
          return await trace?.stop();
        } finally {
          if (sessions.get(page) === session) {
            sessions.delete(page);
          }
        }
      }));
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
