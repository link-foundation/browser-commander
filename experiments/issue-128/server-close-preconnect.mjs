// Reproduces the Safari smoke cleanup stall: http.Server#close() waits for a
// connection a browser opened speculatively (preconnect) but never used,
// while connections that completed a request are closed immediately.
import { createServer } from 'node:http';
import { connect } from 'node:net';

const mode = process.argv[2] ?? 'close';
const server = createServer((_req, res) => res.end('ok'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

// 1) a keep-alive connection that completed one request (idle)
const used = connect(port, '127.0.0.1');
used.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n');
await new Promise((r) => used.once('data', r));
// 2) a preconnected socket that never sends a byte
const pre = connect(port, '127.0.0.1');
await new Promise((r) => pre.once('connect', r));
for (const s of [used, pre]) s.on('error', () => {});
const closed = (s) => new Promise((r) => s.once('close', () => r()));
const started = Date.now();
const usedClosed = closed(used).then(() => console.log(`used socket closed after ${Date.now() - started}ms`));
const preClosed = closed(pre).then(() => console.log(`preconnect socket closed after ${Date.now() - started}ms`));
if (mode === 'closeAll') {
  server.close();
  server.closeAllConnections();
} else {
  server.close();
}
await new Promise((r) => server.once('close', r));
console.log(`node ${process.version} mode=${mode}: server 'close' after ${Date.now() - started}ms`);
await Promise.all([usedClosed, preClosed]);
