import assert from 'node:assert';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, it } from 'node:test';

import {
  acceptUpgrade,
  CLOSE_CODES,
  computeAcceptKey,
  connectWebSocket,
  encodeFrame,
  FrameDecoder,
  OPCODES,
  WebSocketProtocolError,
} from '../../../../src/browser/attach/websocket.js';

const servers = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

/**
 * An HTTP server that upgrades every request and hands the server-side
 * connection to the test.
 */
async function startServer() {
  const connections = [];
  const server = http.createServer((request, response) => {
    response.writeHead(426).end();
  });
  server.on('upgrade', (request, socket, head) => {
    const connection = acceptUpgrade(request, socket, head, {
      maxPayload: 1024,
    });
    if (connection) {
      connections.push(connection);
      server.emit('websocket', connection);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  return {
    url: `ws://127.0.0.1:${server.address().port}/`,
    server,
    connections,
  };
}

async function connectPair() {
  const { url, server } = await startServer();
  const accepted = once(server, 'websocket');
  const client = await connectWebSocket(url);
  const [serverSide] = await accepted;
  return { client, serverSide, url };
}

describe('WebSocket framing', () => {
  it('computes the accept key of RFC 6455 section 1.3', () => {
    assert.equal(
      computeAcceptKey('dGhlIHNhbXBsZSBub25jZQ=='),
      's3pPLMBiTxaQ9kYGzzhZRbK+xOo='
    );
  });

  it('round-trips 7-bit, 16-bit and 64-bit lengths, masked, byte by byte', () => {
    for (const size of [0, 125, 126, 65_535, 70_000]) {
      const payload = Buffer.alloc(size, 'x');
      const decoder = new FrameDecoder({ requireMask: true });
      const frame = encodeFrame(OPCODES.text, payload, { mask: true });
      const frames = [];
      const step = size > 1000 ? 4096 : 1;
      for (let offset = 0; offset < frame.length; offset += step) {
        frames.push(...decoder.push(frame.subarray(offset, offset + step)));
      }
      assert.equal(frames.length, 1, `size ${size}`);
      assert.equal(frames[0].opcode, OPCODES.text);
      assert.equal(frames[0].fin, true);
      assert.ok(frames[0].payload.equals(payload), `size ${size}`);
    }
  });

  it('decodes several frames from one chunk', () => {
    const decoder = new FrameDecoder();
    const frames = decoder.push(
      Buffer.concat([
        encodeFrame(OPCODES.text, 'a', { fin: false }),
        encodeFrame(OPCODES.continuation, 'b'),
        encodeFrame(OPCODES.ping, 'p'),
      ])
    );
    assert.deepEqual(
      frames.map(({ fin, opcode, payload }) => [fin, opcode, String(payload)]),
      [
        [false, OPCODES.text, 'a'],
        [true, OPCODES.continuation, 'b'],
        [true, OPCODES.ping, 'p'],
      ]
    );
  });

  it('rejects frames that break the protocol', () => {
    const cases = [
      [{ requireMask: true }, encodeFrame(OPCODES.text, 'x'), 1002],
      [
        { forbidMask: true },
        encodeFrame(OPCODES.text, 'x', { mask: true }),
        1002,
      ],
      [{}, Buffer.from([0xc1, 0x00]), 1002],
      [{}, Buffer.from([0x83, 0x00]), 1002],
      [{}, encodeFrame(OPCODES.ping, Buffer.alloc(126)), 1002],
      [{}, encodeFrame(OPCODES.ping, 'x', { fin: false }), 1002],
      [{ maxPayload: 10 }, encodeFrame(OPCODES.text, Buffer.alloc(11)), 1009],
      [
        { maxPayload: 10 },
        encodeFrame(OPCODES.text, Buffer.alloc(70_000)),
        1009,
      ],
    ];
    for (const [options, frame, code] of cases) {
      assert.throws(
        () => new FrameDecoder(options).push(frame),
        (error) =>
          error instanceof WebSocketProtocolError && error.code === code
      );
    }
  });
});

describe('WebSocketConnection', () => {
  it('exchanges text messages both ways and answers pings', async () => {
    const { client, serverSide } = await connectPair();

    const toServer = once(serverSide, 'message');
    client.send('héllo');
    assert.deepEqual(await toServer, ['héllo']);

    const toClient = once(client, 'message');
    serverSide.send(JSON.stringify({ id: 1 }));
    assert.deepEqual(await toClient, ['{"id":1}']);

    const pong = once(client, 'pong');
    client.ping(Buffer.from('beat'));
    assert.equal(String((await pong)[0]), 'beat');

    const closed = Promise.all([
      once(client, 'close'),
      once(serverSide, 'close'),
    ]);
    client.close(CLOSE_CODES.normal, 'bye');
    const [[clientClose], [serverClose]] = await closed;
    assert.deepEqual(serverClose, { code: 1000, reason: 'bye' });
    assert.equal(clientClose.code, 1000);
    assert.equal(client.send('late'), false);
  });

  it('joins fragmented messages', async () => {
    const { client, serverSide } = await connectPair();
    const message = once(serverSide, 'message');
    client.socket.write(
      Buffer.concat([
        encodeFrame(OPCODES.text, 'frag', { mask: true, fin: false }),
        encodeFrame(OPCODES.ping, '', { mask: true }),
        encodeFrame(OPCODES.continuation, 'mented', { mask: true }),
      ])
    );
    assert.deepEqual(await message, ['fragmented']);
    client.terminate();
  });

  for (const [name, frame, code] of [
    ['an unmasked client frame', encodeFrame(OPCODES.text, 'x'), 1002],
    [
      'invalid UTF-8',
      encodeFrame(OPCODES.text, Buffer.from([0xc3, 0x28]), { mask: true }),
      1007,
    ],
    [
      'a binary message',
      encodeFrame(OPCODES.binary, 'x', { mask: true }),
      1003,
    ],
    [
      'a message over maxPayload',
      encodeFrame(OPCODES.text, Buffer.alloc(2048), { mask: true }),
      1009,
    ],
    [
      'a stray continuation frame',
      encodeFrame(OPCODES.continuation, 'x', { mask: true }),
      1002,
    ],
  ]) {
    it(`closes with ${code} on ${name}`, async () => {
      const { client, serverSide } = await connectPair();
      const closed = once(client, 'close');
      const serverClosed = once(serverSide, 'close');
      client.socket.write(frame);
      const [{ code: received }] = await closed;
      assert.equal(received, code);
      await serverClosed;
    });
  }

  it('refuses a bad handshake with 400 and an old version with 426', async () => {
    const { url } = await startServer();
    const { port } = new URL(url);
    const statusOf = (headers) =>
      new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.write(`GET / HTTP/1.1\r\nHost: x\r\n${headers}\r\n`);
        });
        let text = '';
        socket.on('data', (chunk) => {
          text += chunk;
        });
        socket.on('end', () => resolve(Number(text.split(' ')[1])));
        socket.on('error', reject);
      });
    assert.equal(
      await statusOf(
        'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: short\r\nSec-WebSocket-Version: 13\r\n'
      ),
      400
    );
    assert.equal(
      await statusOf(
        'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 8\r\n'
      ),
      426
    );
    assert.throws(() => connectWebSocket('http://127.0.0.1/'), TypeError);
  });
});
