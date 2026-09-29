import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { setImmediate } from 'node:timers';
import { TextDecoder } from 'node:util';

/**
 * A minimal RFC 6455 WebSocket for the extension relay (issue #102,
 * addendum, mode 2).
 *
 * The relay only exchanges small JSON text messages with one local extension,
 * so this implements exactly that part of the protocol and no more:
 *
 * - the opening handshake on a `node:http` `'upgrade'` event (server) or an
 *   `http.request` upgrade (client, used by tests and tools);
 * - text messages, fragmented or not, validated as UTF-8;
 * - ping/pong and the close handshake.
 *
 * Binary messages, extensions (permessage-deflate) and subprotocols are not
 * negotiated. A protocol violation closes the connection with the RFC status
 * code: 1002 (protocol error, for example an unmasked client frame), 1003
 * (binary data), 1007 (invalid UTF-8) or 1009 (message too big).
 */

/** The GUID RFC 6455 section 1.3 appends to the client key. */
export const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Frame opcodes (RFC 6455 section 5.2). */
export const OPCODES = Object.freeze({
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
});

/** Close status codes used here (RFC 6455 section 7.4.1). */
export const CLOSE_CODES = Object.freeze({
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  unsupportedData: 1003,
  noStatus: 1005,
  abnormal: 1006,
  invalidPayload: 1007,
  policyViolation: 1008,
  messageTooBig: 1009,
});

/** Messages larger than this close the connection with 1009. */
export const DEFAULT_MAX_PAYLOAD = 64 * 1024 * 1024;

const MAX_CONTROL_PAYLOAD = 125;

/** A frame or handshake that breaks RFC 6455; `code` is the close code. */
export class WebSocketProtocolError extends Error {
  constructor(message, code = CLOSE_CODES.protocolError) {
    super(message);
    this.name = 'WebSocketProtocolError';
    this.code = code;
  }
}

/**
 * The `Sec-WebSocket-Accept` value for a client's `Sec-WebSocket-Key`.
 *
 * @param {string} key
 * @returns {string}
 */
export function computeAcceptKey(key) {
  return createHash('sha1')
    .update(key + WEBSOCKET_GUID)
    .digest('base64');
}

/**
 * Encode one frame.
 *
 * @param {number} opcode - One of {@link OPCODES}
 * @param {Buffer|string} [payload]
 * @param {Object} [options]
 * @param {boolean} [options.mask=false] - Mask the payload (client frames)
 * @param {boolean} [options.fin=true] - Final fragment
 * @returns {Buffer}
 */
export function encodeFrame(
  opcode,
  payload = Buffer.alloc(0),
  { mask = false, fin = true } = {}
) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (data.length < 126) {
    header = Buffer.alloc(2);
    header[1] = data.length;
  } else if (data.length < 0x10000) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  header[0] = (fin ? 0x80 : 0) | opcode;
  if (!mask) {
    return Buffer.concat([header, data]);
  }
  header[1] |= 0x80;
  const maskingKey = randomBytes(4);
  const masked = Buffer.alloc(data.length);
  for (let index = 0; index < data.length; index++) {
    masked[index] = data[index] ^ maskingKey[index % 4];
  }
  return Buffer.concat([header, maskingKey, masked]);
}

/**
 * Incremental frame parser: feed it socket chunks, get whole frames back.
 */
export class FrameDecoder {
  /**
   * @param {Object} [options]
   * @param {boolean} [options.requireMask=false] - Client-to-server frames must be masked
   * @param {boolean} [options.forbidMask=false] - Server-to-client frames must not be masked
   * @param {number} [options.maxPayload=DEFAULT_MAX_PAYLOAD]
   */
  constructor({
    requireMask = false,
    forbidMask = false,
    maxPayload = DEFAULT_MAX_PAYLOAD,
  } = {}) {
    this.requireMask = requireMask;
    this.forbidMask = forbidMask;
    this.maxPayload = maxPayload;
    this.buffer = Buffer.alloc(0);
  }

  /**
   * @param {Buffer} chunk
   * @returns {Array<{fin: boolean, opcode: number, payload: Buffer}>}
   * @throws {WebSocketProtocolError}
   */
  push(chunk) {
    this.buffer =
      this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    const frames = [];
    for (;;) {
      const frame = this.next();
      if (!frame) {
        return frames;
      }
      frames.push(frame);
    }
  }

  readLength(second) {
    const length = second & 0x7f;
    if (length < 126) {
      return { length, offset: 2 };
    }
    if (length === 126) {
      return this.buffer.length < 4
        ? null
        : { length: this.buffer.readUInt16BE(2), offset: 4 };
    }
    if (this.buffer.length < 10) {
      return null;
    }
    const long = this.buffer.readBigUInt64BE(2);
    if (long > BigInt(this.maxPayload)) {
      throw new WebSocketProtocolError(
        'Frame too big',
        CLOSE_CODES.messageTooBig
      );
    }
    return { length: Number(long), offset: 10 };
  }

  next() {
    if (this.buffer.length < 2) {
      return null;
    }
    const [first, second] = this.buffer;
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    if ((first & 0x70) !== 0) {
      throw new WebSocketProtocolError('Reserved bits must be 0');
    }
    if (!Object.values(OPCODES).includes(opcode)) {
      throw new WebSocketProtocolError(`Unknown opcode ${opcode}`);
    }
    if (this.requireMask && !masked) {
      throw new WebSocketProtocolError('Client frames must be masked');
    }
    if (this.forbidMask && masked) {
      throw new WebSocketProtocolError('Server frames must not be masked');
    }
    const header = this.readLength(second);
    if (!header) {
      return null;
    }
    const { length } = header;
    if (opcode >= OPCODES.close && (length > MAX_CONTROL_PAYLOAD || !fin)) {
      throw new WebSocketProtocolError('Invalid control frame');
    }
    if (length > this.maxPayload) {
      throw new WebSocketProtocolError(
        'Frame too big',
        CLOSE_CODES.messageTooBig
      );
    }
    const maskOffset = header.offset;
    const payloadOffset = maskOffset + (masked ? 4 : 0);
    if (this.buffer.length < payloadOffset + length) {
      return null;
    }
    const payload = Buffer.from(
      this.buffer.subarray(payloadOffset, payloadOffset + length)
    );
    if (masked) {
      const maskingKey = this.buffer.subarray(maskOffset, payloadOffset);
      for (let index = 0; index < payload.length; index++) {
        payload[index] ^= maskingKey[index % 4];
      }
    }
    this.buffer = this.buffer.subarray(payloadOffset + length);
    return { fin, opcode, payload };
  }
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

function decodeText(payload) {
  try {
    return UTF8.decode(payload);
  } catch {
    throw new WebSocketProtocolError(
      'Invalid UTF-8',
      CLOSE_CODES.invalidPayload
    );
  }
}

function isValidCloseCode(code) {
  return (
    (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
    (code >= 3000 && code <= 4999)
  );
}

/**
 * One open WebSocket connection over a socket that finished the handshake.
 *
 * Events: `'message'` (string), `'close'` ({code, reason}) once, and
 * `'error'` (Error) for socket errors.
 */
export class WebSocketConnection extends EventEmitter {
  /**
   * @param {import('node:net').Socket} socket
   * @param {Object} [options]
   * @param {'server'|'client'} [options.role='server']
   * @param {Buffer} [options.head] - Bytes read past the handshake
   * @param {number} [options.maxPayload=DEFAULT_MAX_PAYLOAD]
   */
  constructor(
    socket,
    { role = 'server', head, maxPayload = DEFAULT_MAX_PAYLOAD } = {}
  ) {
    super();
    this.socket = socket;
    this.role = role;
    this.maxPayload = maxPayload;
    this.decoder = new FrameDecoder({
      requireMask: role === 'server',
      forbidMask: role === 'client',
      maxPayload,
    });
    this.fragments = null;
    this.closeSent = false;
    this.closeReceived = null;
    this.closed = false;
    socket.setNoDelay?.(true);
    socket.on('data', (chunk) => this.receive(chunk));
    socket.on('error', (error) => {
      if (this.listenerCount('error') > 0) {
        this.emit('error', error);
      }
    });
    socket.on('close', () => this.finish());
    if (head?.length) {
      // After the caller had a chance to add its listeners.
      setImmediate(() => this.receive(head));
    }
  }

  /** True until a close frame is sent or the socket ends. */
  get open() {
    return !this.closed && !this.closeSent;
  }

  /**
   * Send a text message.
   *
   * @param {string} text
   * @returns {boolean} False when the connection is already closing
   */
  send(text) {
    if (!this.open) {
      return false;
    }
    this.write(OPCODES.text, Buffer.from(String(text), 'utf8'));
    return true;
  }

  /** Send a ping; the peer answers with a pong. */
  ping(data = Buffer.alloc(0)) {
    if (this.open) {
      this.write(OPCODES.ping, data);
    }
  }

  /**
   * Start the close handshake. The socket ends when the peer answers, or
   * after `timeoutMs` without an answer.
   *
   * @param {number} [code=1000]
   * @param {string} [reason='']
   * @param {number} [timeoutMs=1000]
   */
  close(code = CLOSE_CODES.normal, reason = '', timeoutMs = 1_000) {
    if (this.closed) {
      return;
    }
    if (!this.closeSent) {
      this.sendClose(code, reason);
    }
    if (this.closeReceived) {
      this.endSocket();
      return;
    }
    const timer = setTimeout(() => this.socket.destroy(), timeoutMs);
    timer.unref?.();
    this.socket.once('close', () => clearTimeout(timer));
  }

  /** Drop the connection without a close handshake. */
  terminate() {
    this.socket.destroy();
  }

  write(opcode, payload) {
    if (this.socket.writable) {
      this.socket.write(
        encodeFrame(opcode, payload, { mask: this.role === 'client' })
      );
    }
  }

  sendClose(code, reason) {
    this.closeSent = true;
    const reasonBytes = Buffer.from(reason, 'utf8').subarray(0, 123);
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    this.write(OPCODES.close, payload);
  }

  endSocket() {
    // The server closes the TCP connection first (RFC 6455 section 7.1.1).
    if (this.role === 'server') {
      this.socket.end();
    }
  }

  fail(error) {
    if (!this.closeSent) {
      this.sendClose(error.code ?? CLOSE_CODES.protocolError, error.message);
    }
    this.socket.end();
    const timer = setTimeout(() => this.socket.destroy(), 1_000);
    timer.unref?.();
  }

  receive(chunk) {
    if (this.closed || this.closeReceived) {
      return;
    }
    try {
      for (const frame of this.decoder.push(chunk)) {
        this.handleFrame(frame);
        if (this.closeReceived) {
          return;
        }
      }
    } catch (error) {
      if (!(error instanceof WebSocketProtocolError)) {
        throw error;
      }
      this.fail(error);
    }
  }

  handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case OPCODES.ping:
        if (!this.closeSent) {
          this.write(OPCODES.pong, payload);
        }
        return;
      case OPCODES.pong:
        this.emit('pong', payload);
        return;
      case OPCODES.close:
        this.handleClose(payload);
        return;
      case OPCODES.binary:
        throw new WebSocketProtocolError(
          'Binary messages are not supported',
          CLOSE_CODES.unsupportedData
        );
      default:
        this.handleData({ fin, opcode, payload });
    }
  }

  handleData({ fin, opcode, payload }) {
    if (opcode === OPCODES.continuation && !this.fragments) {
      throw new WebSocketProtocolError('Unexpected continuation frame');
    }
    if (opcode === OPCODES.text && this.fragments) {
      throw new WebSocketProtocolError('Expected a continuation frame');
    }
    const parts = [...(this.fragments ?? []), payload];
    const size = parts.reduce((total, part) => total + part.length, 0);
    if (size > this.maxPayload) {
      throw new WebSocketProtocolError(
        'Message too big',
        CLOSE_CODES.messageTooBig
      );
    }
    if (!fin) {
      this.fragments = parts;
      return;
    }
    this.fragments = null;
    const text = decodeText(Buffer.concat(parts));
    if (!this.closeSent) {
      this.emit('message', text);
    }
  }

  handleClose(payload) {
    if (payload.length === 1) {
      throw new WebSocketProtocolError('Invalid close frame');
    }
    const code =
      payload.length >= 2 ? payload.readUInt16BE(0) : CLOSE_CODES.noStatus;
    if (payload.length >= 2 && !isValidCloseCode(code)) {
      throw new WebSocketProtocolError(`Invalid close code ${code}`);
    }
    const reason = decodeText(payload.subarray(2));
    this.closeReceived = { code, reason };
    if (!this.closeSent) {
      this.sendClose(
        code === CLOSE_CODES.noStatus ? CLOSE_CODES.normal : code,
        ''
      );
    }
    this.endSocket();
  }

  finish() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.emit(
      'close',
      this.closeReceived ?? { code: CLOSE_CODES.abnormal, reason: '' }
    );
  }
}

/**
 * Answer an HTTP upgrade request with an error status and close the socket.
 *
 * @param {import('node:net').Socket} socket
 * @param {number} status - HTTP status code such as 403
 * @param {string} [message] - Plain-text body
 */
export function rejectUpgrade(socket, status, message = '') {
  const body = Buffer.from(message, 'utf8');
  const statusText = http.STATUS_CODES[status] ?? 'Error';
  socket.end(
    Buffer.concat([
      Buffer.from(
        `HTTP/1.1 ${status} ${statusText}\r\n` +
          'Connection: close\r\n' +
          'Content-Type: text/plain; charset=utf-8\r\n' +
          `Content-Length: ${body.length}\r\n\r\n`
      ),
      body,
    ])
  );
}

function headerHasToken(value, token) {
  return String(value ?? '')
    .toLowerCase()
    .split(',')
    .some((part) => part.trim() === token);
}

/**
 * Complete the server side of the opening handshake for a `node:http`
 * `'upgrade'` event. An invalid handshake is answered with 400 (or 426 for an
 * unsupported version) and null is returned.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:net').Socket} socket
 * @param {Buffer} [head]
 * @param {Object} [options]
 * @param {number} [options.maxPayload]
 * @returns {WebSocketConnection|null}
 */
export function acceptUpgrade(request, socket, head, { maxPayload } = {}) {
  const key = request.headers['sec-websocket-key'];
  if (
    request.method !== 'GET' ||
    !headerHasToken(request.headers.upgrade, 'websocket') ||
    !headerHasToken(request.headers.connection, 'upgrade') ||
    typeof key !== 'string' ||
    Buffer.from(key, 'base64').length !== 16
  ) {
    rejectUpgrade(socket, 400, 'Invalid WebSocket handshake');
    return null;
  }
  if (request.headers['sec-websocket-version'] !== '13') {
    socket.end(
      'HTTP/1.1 426 Upgrade Required\r\n' +
        'Sec-WebSocket-Version: 13\r\n' +
        'Connection: close\r\n' +
        'Content-Length: 0\r\n\r\n'
    );
    return null;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${computeAcceptKey(key)}\r\n\r\n`
  );
  return new WebSocketConnection(socket, { role: 'server', head, maxPayload });
}

/**
 * Open a client connection. Used by the tests and by tools that talk to the
 * relay; the extension itself uses the browser's WebSocket.
 *
 * @param {string} url - ws:// URL
 * @param {Object} [options]
 * @param {Object<string,string>} [options.headers] - Extra handshake headers such as Origin
 * @param {number} [options.timeoutMs=5000]
 * @returns {Promise<WebSocketConnection>} Rejects with an Error whose `statusCode` is the HTTP status when the server refuses the upgrade
 */
export function connectWebSocket(
  url,
  { headers = {}, timeoutMs = 5_000 } = {}
) {
  const target = new URL(url);
  if (target.protocol !== 'ws:') {
    throw new TypeError(`Only ws:// URLs are supported, got ${url}`);
  }
  const key = randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port || 80,
      path: `${target.pathname}${target.search}`,
      timeout: timeoutMs,
      headers: {
        ...headers,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });
    request.on('timeout', () =>
      request.destroy(new Error(`WebSocket handshake timed out: ${url}`))
    );
    request.on('error', reject);
    request.on('response', (response) => {
      const error = new Error(
        `WebSocket upgrade refused with HTTP ${response.statusCode}`
      );
      error.statusCode = response.statusCode;
      response.resume();
      reject(error);
    });
    request.on('upgrade', (response, socket, head) => {
      if (response.headers['sec-websocket-accept'] !== computeAcceptKey(key)) {
        socket.destroy();
        reject(new Error('Invalid Sec-WebSocket-Accept'));
        return;
      }
      socket.setTimeout(0);
      resolve(new WebSocketConnection(socket, { role: 'client', head }));
    });
    request.end();
  });
}
