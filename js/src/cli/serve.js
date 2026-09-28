/**
 * `browser-commander serve --stdio`: JSON-RPC 2.0 over stdin/stdout, one
 * message per line (issue #104). Requests may be pipelined; each response
 * carries its request id, and server notifications (`events.emit`) have none.
 */
import { once } from 'node:events';
import readline from 'node:readline';

import { createDispatcher } from './dispatcher.js';
import { RPC_ERROR, toRpcError } from './rpc-error.js';

/** How long pending requests may run after stdin closes. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function isValidId(id) {
  return id === null || typeof id === 'string' || typeof id === 'number';
}

function isRequest(message) {
  return (
    message !== null &&
    typeof message === 'object' &&
    !Array.isArray(message) &&
    message.jsonrpc === '2.0' &&
    typeof message.method === 'string' &&
    (!('id' in message) || isValidId(message.id))
  );
}

/**
 * Build the handler for one JSON-RPC message or batch.
 *
 * @param {{dispatch: Function}} dispatcher
 * @returns {(message: unknown) => Promise<Object|Object[]|null>} The response, or null for notifications
 */
export function createMessageHandler(dispatcher) {
  async function handleOne(message) {
    if (!isRequest(message)) {
      const id = isValidId(message?.id) ? message.id : null;
      return errorResponse(id, RPC_ERROR.INVALID_REQUEST, 'Invalid request');
    }
    const notification = !('id' in message);
    try {
      const result = await dispatcher.dispatch(
        message.method,
        message.params ?? {}
      );
      return notification
        ? null
        : { jsonrpc: '2.0', id: message.id, result: result ?? null };
    } catch (error) {
      return notification
        ? null
        : { jsonrpc: '2.0', id: message.id, error: toRpcError(error) };
    }
  }

  return async function handleMessage(message) {
    if (!Array.isArray(message)) {
      return await handleOne(message);
    }
    if (message.length === 0) {
      return errorResponse(null, RPC_ERROR.INVALID_REQUEST, 'Empty batch');
    }
    const responses = (await Promise.all(message.map(handleOne))).filter(
      Boolean
    );
    return responses.length > 0 ? responses : null;
  };
}

/**
 * Parse one line and answer it.
 *
 * @param {string} line
 * @param {Function} handleMessage - From {@link createMessageHandler}
 * @returns {Promise<Object|Object[]|null>}
 */
export async function handleLine(line, handleMessage) {
  if (line.trim() === '') {
    return null;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    return errorResponse(
      null,
      RPC_ERROR.PARSE_ERROR,
      `Parse error: ${error.message}`
    );
  }
  return await handleMessage(message);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
}

/**
 * Serve JSON-RPC until `input` ends, then close every session.
 *
 * @param {Object} options
 * @param {import('node:stream').Readable} options.input - Usually process.stdin
 * @param {(text: string) => void} options.write - Writes one line to stdout
 * @param {Object} [options.dependencies] - Dispatcher dependencies (tests)
 * @param {number} [options.drainTimeoutMs] - Grace for in-flight requests
 * @returns {Promise<void>}
 */
export async function serveStdio({
  input,
  write,
  dependencies,
  drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
}) {
  const send = (message) => write(`${JSON.stringify(message)}\n`);
  const dispatcher = createDispatcher({
    dependencies,
    notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
  });
  const handleMessage = createMessageHandler(dispatcher);
  const pending = new Set();
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const task = handleLine(line, handleMessage)
      .then((response) => {
        if (response) {
          send(response);
        }
      })
      .catch(() => {});
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  await once(lines, 'close');
  await Promise.race([Promise.allSettled([...pending]), delay(drainTimeoutMs)]);
  await dispatcher.close();
}
