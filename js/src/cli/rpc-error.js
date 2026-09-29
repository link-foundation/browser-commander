/**
 * JSON-RPC 2.0 error codes used by `serve --stdio` and `run` (issue #104).
 * See docs/cli-and-bridge.md, "Errors".
 */
export const RPC_ERROR = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  ENGINE_ERROR: -32000,
});

/** An error that carries its JSON-RPC code. */
export class RpcError extends Error {
  /**
   * @param {number} code - One of {@link RPC_ERROR}
   * @param {string} message - Human-readable message
   * @param {Object} [data] - Optional structured detail
   */
  constructor(code, message, data) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

/** Shorthand for an invalid-params error. */
export function invalidParams(message) {
  return new RpcError(RPC_ERROR.INVALID_PARAMS, message);
}

/** A required non-empty string param, or an invalid-params error. */
export function requireString(params, name) {
  const value = params[name];
  if (typeof value !== 'string' || value === '') {
    throw invalidParams(`${name} must be a non-empty string`);
  }
  return value;
}

/** `{name, message}` of any thrown value. */
export function describeError(error) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: 'Error', message: String(error) };
}

/**
 * The JSON-RPC `error` member for a thrown value: an {@link RpcError} keeps its
 * code, anything else is an engine error with name, message and stack.
 *
 * @param {unknown} error
 * @param {Object} [options]
 * @param {boolean} [options.stack=true] - Include the stack in `data`
 * @returns {{code: number, message: string, data: (Object|undefined)}}
 */
export function toRpcError(error, { stack = true } = {}) {
  if (error instanceof RpcError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.data === undefined ? {} : { data: error.data }),
    };
  }
  const { name, message } = describeError(error);
  return {
    code: RPC_ERROR.ENGINE_ERROR,
    message,
    data: {
      name,
      message,
      ...(stack && error instanceof Error ? { stack: error.stack } : {}),
    },
  };
}
