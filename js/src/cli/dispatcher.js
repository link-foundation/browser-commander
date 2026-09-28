/**
 * The one dispatcher behind `serve --stdio` and `run` (issue #104).
 *
 * It owns the handle table, the sessions and the event subscriptions of one
 * connection, and maps a JSON-RPC method name and params to a result or a
 * thrown error. Transports (the stdio server and the script runner) only
 * frame messages around it.
 */
import { HANDLE_METHODS, removeSubscription } from './handle-methods.js';
import { HandleTable } from './handles.js';
import { HIGH_LEVEL_METHODS } from './high-level-methods.js';
import { DEFAULT_DEPENDENCIES } from './modules.js';
import { RPC_ERROR, RpcError, invalidParams } from './rpc-error.js';
import { SessionTable } from './sessions.js';

const METHODS = Object.freeze({ ...HIGH_LEVEL_METHODS, ...HANDLE_METHODS });

/** Every method name the dispatcher answers. */
export const METHOD_NAMES = Object.freeze(Object.keys(METHODS).sort());

/**
 * Create a dispatcher.
 *
 * @param {Object} [options]
 * @param {Object} [options.dependencies] - Replacements for {@link DEFAULT_DEPENDENCIES}
 * @param {(method: string, params: Object) => void} [options.notify] - Sends a server notification (`events.emit`)
 * @returns {{dispatch: (method: string, params?: Object) => Promise<unknown>, close: () => Promise<void>, state: Object}}
 */
export function createDispatcher({
  dependencies = {},
  notify = () => {},
} = {}) {
  const state = {
    dependencies: { ...DEFAULT_DEPENDENCIES, ...dependencies },
    handles: new HandleTable(),
    sessions: new SessionTable(),
    subscriptions: new Map(),
    nextSubscription: 1,
    notify,
  };

  async function dispatch(method, params = {}) {
    if (typeof method !== 'string' || !Object.hasOwn(METHODS, method)) {
      throw new RpcError(
        RPC_ERROR.METHOD_NOT_FOUND,
        `Unknown method: ${method}`
      );
    }
    if (
      params === null ||
      typeof params !== 'object' ||
      Array.isArray(params)
    ) {
      throw invalidParams('params must be an object');
    }
    return await METHODS[method](state, params);
  }

  /** Remove every subscription and close every session. */
  async function close() {
    for (const subscription of [...state.subscriptions.keys()]) {
      removeSubscription(state, subscription);
    }
    await state.sessions.closeAll();
  }

  return { dispatch, close, state };
}

/**
 * Replace `"$session"` anywhere in params with the latest session id.
 *
 * @param {unknown} value - Step params
 * @param {string|null} session - Latest session id
 * @returns {unknown}
 */
export function substituteSession(value, session) {
  if (value === '$session') {
    return session ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteSession(item, session));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        substituteSession(item, session),
      ])
    );
  }
  return value;
}
