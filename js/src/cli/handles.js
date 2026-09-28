/**
 * Remote object handles and the value encoding of the `serve --stdio` bridge
 * (issue #104, docs/cli-and-bridge.md "Value encoding").
 *
 * JSON values cross the bridge unchanged. Anything else - an engine object, a
 * function, a buffer, a date - is tagged, so a client in any language can hold
 * a Playwright `Page` or a Puppeteer `ElementHandle` as `{"$handle": "h3"}`
 * and pass it back as an argument.
 */
import { invalidParams } from './rpc-error.js';

const TAGS = Object.freeze([
  '$handle',
  '$binary',
  '$function',
  '$undefined',
  '$date',
  '$regexp',
  '$bigint',
  '$error',
]);

function isModuleNamespace(value) {
  return Object.prototype.toString.call(value) === '[object Module]';
}

/** True for `{}` literals and null-prototype records, not class instances. */
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || isModuleNamespace(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isBinary(value) {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}

/**
 * The class name a client sees for a handle.
 *
 * Bundlers rename colliding classes (`Page2`), so a trailing number after a
 * lowercase letter is dropped to keep the public name.
 */
export function typeName(value) {
  if (typeof value === 'function') {
    return 'Function';
  }
  const name = value?.constructor?.name;
  if (!name || isModuleNamespace(value)) {
    return 'Object';
  }
  return name.replace(/(?<=[a-z])\d+$/u, '');
}

/**
 * A table of remote objects with deterministic ids (`h1`, `h2`, …).
 *
 * The same object always gets the same id while it is registered, so a page
 * returned by two calls is one handle.
 */
export class HandleTable {
  constructor() {
    this.nextId = 1;
    this.byId = new Map();
    this.idOf = new Map();
  }

  /** Register an object (or reuse its id) and return the encoded handle. */
  register(value) {
    let id = this.idOf.get(value);
    if (!id) {
      id = `h${this.nextId++}`;
      this.byId.set(id, value);
      this.idOf.set(value, id);
    }
    return { $handle: id, type: typeName(value) };
  }

  /** The object behind an id, or an invalid-params error. */
  get(id) {
    if (!this.byId.has(id)) {
      throw invalidParams(`Unknown handle: ${id}`);
    }
    return this.byId.get(id);
  }

  /** Forget a handle. Returns whether it existed. */
  dispose(id) {
    if (!this.byId.has(id)) {
      return false;
    }
    this.idOf.delete(this.byId.get(id));
    this.byId.delete(id);
    return true;
  }
}

function encodeError(error) {
  return { $error: { name: error.name, message: error.message } };
}

/**
 * Encode a value for the wire.
 *
 * @param {unknown} value
 * @param {HandleTable} handles - Where non-JSON objects are registered
 * @param {Set<Object>} [seen] - Cycle guard for plain objects and arrays
 * @returns {unknown} JSON-compatible value
 */
export function encodeValue(value, handles, seen = new Set()) {
  if (value === undefined) {
    return { $undefined: true };
  }
  if (value === null || ['boolean', 'string'].includes(typeof value)) {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'bigint') {
    return { $bigint: value.toString() };
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (isBinary(value)) {
    return { $binary: Buffer.from(value).toString('base64') };
  }
  if (value instanceof Date) {
    return { $date: value.toISOString() };
  }
  if (value instanceof RegExp) {
    return { $regexp: { source: value.source, flags: value.flags } };
  }
  if (value instanceof Error) {
    return encodeError(value);
  }
  const container = Array.isArray(value) || isPlainObject(value);
  if (!container || seen.has(value)) {
    return handles.register(value);
  }
  seen.add(value);
  const encoded = Array.isArray(value)
    ? value.map((item) => encodeValue(item, handles, seen))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          encodeValue(item, handles, seen),
        ])
      );
  seen.delete(value);
  return encoded;
}

/**
 * Compile a `$function` source on the server.
 *
 * The result's `toString()` is the original source, which is what both
 * engines serialize when the function is evaluated in the page.
 */
export function compileFunction(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw invalidParams('$function must be a function source string');
  }
  let compiled;
  try {
    compiled = (0, eval)(`(${source})`);
  } catch (error) {
    throw invalidParams(`Invalid $function source: ${error.message}`);
  }
  if (typeof compiled !== 'function') {
    throw invalidParams('$function source did not evaluate to a function');
  }
  return compiled;
}

function decodeError({ name = 'Error', message = '' } = {}) {
  const error = new Error(message);
  error.name = name;
  return error;
}

const DECODERS = {
  $handle: (tag, handles) => handles.get(tag),
  $binary: (tag) => Buffer.from(String(tag), 'base64'),
  $function: (tag) => compileFunction(tag),
  $undefined: () => undefined,
  $date: (tag) => new Date(tag),
  $regexp: (tag) => new RegExp(tag?.source ?? '', tag?.flags ?? ''),
  $bigint: (tag) => BigInt(tag),
  $error: (tag) => decodeError(tag),
};

function tagOf(value) {
  return TAGS.find((tag) => Object.hasOwn(value, tag));
}

/**
 * Decode a value received from a client.
 *
 * @param {unknown} value
 * @param {HandleTable} handles - Resolves `$handle` references
 * @returns {unknown}
 */
export function decodeValue(value, handles) {
  if (Array.isArray(value)) {
    return value.map((item) => decodeValue(item, handles));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const tag = tagOf(value);
  if (tag) {
    return DECODERS[tag](value[tag], handles);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      decodeValue(item, handles),
    ])
  );
}

function isPublicName(name) {
  return (
    typeof name === 'string' && name !== 'constructor' && !name.startsWith('_')
  );
}

function collectMembers(target) {
  const methods = new Set();
  const properties = new Set();
  let current = target;
  while (current && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (!isPublicName(name) || (current === target && name === 'prototype')) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, name);
      if (typeof descriptor.value === 'function') {
        methods.add(name);
      } else {
        properties.add(name);
      }
    }
    current = Object.getPrototypeOf(current);
  }
  for (const name of methods) {
    properties.delete(name);
  }
  return { methods, properties };
}

/**
 * Describe a remote object: every callable member on the object and its
 * prototype chain, and its other public properties.
 *
 * @param {unknown} target
 * @returns {{type: string, methods: string[], properties: string[]}}
 */
export function describeObject(target) {
  const { methods, properties } =
    target !== null && ['object', 'function'].includes(typeof target)
      ? collectMembers(target)
      : { methods: new Set(), properties: new Set() };
  return {
    type: typeName(target),
    methods: [...methods].sort(),
    properties: [...properties].sort(),
  };
}
