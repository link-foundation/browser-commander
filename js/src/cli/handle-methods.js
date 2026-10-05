/**
 * Generic handle methods (docs/cli-and-bridge.md, "Generic handle methods").
 *
 * They reach every public method of Playwright and Puppeteer through remote
 * object handles, so a Rust or Python program - or a shell script - can call
 * `page.route()`, `locator.boundingBox()` or `cdpSession.send()` without a
 * native binding for each of them.
 */
import { decodeValue, describeObject, encodeValue } from './handles.js';
import { invalidParams, requireString } from './rpc-error.js';

const ENGINE_ROOTS = Object.freeze(['playwright', 'puppeteer', 'selenium']);

function targetOf(state, params) {
  const handle = params.handle;
  const id = typeof handle === 'object' && handle ? handle.$handle : handle;
  return state.handles.get(requireString({ id }, 'id'));
}

/** Roots are always handles, even when the engine object is a plain object. */
function handleOrNull(state, value) {
  return value === null || value === undefined
    ? null
    : state.handles.register(value);
}

/**
 * `playwright` and `puppeteer` resolve to the engine's entry object;
 * `session:<id>` to the session's browser, context and page.
 */
async function root(state, params) {
  const name = requireString(params, 'name');
  if (name.startsWith('session:')) {
    const session = state.sessions.get(name.slice('session:'.length));
    return {
      browser: handleOrNull(state, session.browser),
      context: handleOrNull(state, session.context),
      page: handleOrNull(state, session.page),
      ...(session.engine === 'selenium'
        ? { driver: handleOrNull(state, session.driver) }
        : {}),
    };
  }
  if (!ENGINE_ROOTS.includes(name)) {
    throw invalidParams(
      `Unknown root "${name}"; expected playwright, puppeteer, selenium or session:<id>`
    );
  }
  const module = await state.dependencies.loadEngine(name);
  return state.handles.register(module.default ?? module);
}

async function call(state, params) {
  const target = targetOf(state, params);
  const method = requireString(params, 'method');
  const args = params.args ?? [];
  if (!Array.isArray(args)) {
    throw invalidParams('args must be an array');
  }
  if (typeof target?.[method] !== 'function') {
    throw invalidParams(`${method} is not a method of this handle`);
  }
  const result = await target[method](...decodeValue(args, state.handles));
  return encodeValue(result, state.handles);
}

async function get(state, params) {
  const target = targetOf(state, params);
  const property = requireString(params, 'property');
  const value = target?.[property];
  return encodeValue(
    value instanceof Promise ? await value : value,
    state.handles
  );
}

/** Instantiate an engine constructor obtained through `handle.get`. */
function construct(state, params) {
  const target = targetOf(state, params);
  const args = params.args ?? [];
  if (typeof target !== 'function' || !Array.isArray(args)) {
    throw invalidParams(
      'handle.construct requires a constructor handle and an args array'
    );
  }
  const result = Reflect.construct(target, decodeValue(args, state.handles));
  return encodeValue(result, state.handles);
}

function dispose(state, params) {
  const id =
    typeof params.handle === 'object' && params.handle
      ? params.handle.$handle
      : params.handle;
  if (!state.handles.dispose(requireString({ id }, 'id'))) {
    throw invalidParams(`Unknown handle: ${id}`);
  }
  return { disposed: true };
}

function describe(state, params) {
  return describeObject(targetOf(state, params));
}

function subscribe(state, params) {
  const target = targetOf(state, params);
  const event = requireString(params, 'event');
  if (typeof target?.on !== 'function') {
    throw invalidParams('This handle does not emit events');
  }
  const subscription = `e${state.nextSubscription++}`;
  const listener = (...args) =>
    state.notify('events.emit', {
      subscription,
      args: args.map((arg) => encodeValue(arg, state.handles)),
    });
  target.on(event, listener);
  state.subscriptions.set(subscription, { target, event, listener });
  return { subscription };
}

/** Remove one subscription's listener. */
export function removeSubscription(state, subscription) {
  const entry = state.subscriptions.get(subscription);
  if (!entry) {
    return false;
  }
  state.subscriptions.delete(subscription);
  const { target, event, listener } = entry;
  const off = target.off ?? target.removeListener;
  off?.call(target, event, listener);
  return true;
}

function unsubscribe(state, params) {
  const subscription = requireString(params, 'subscription');
  if (!removeSubscription(state, subscription)) {
    throw invalidParams(`Unknown subscription: ${subscription}`);
  }
  return { unsubscribed: true };
}

/** Method name to implementation. */
export const HANDLE_METHODS = Object.freeze({
  'handle.root': root,
  'handle.call': call,
  'handle.get': get,
  'handle.construct': construct,
  'handle.dispose': dispose,
  'handle.describe': describe,
  'events.subscribe': subscribe,
  'events.unsubscribe': unsubscribe,
});
