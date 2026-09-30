// Keep the shared CLI's JSON-RPC byte stream in its command-stream-owned process.
const net = require('node:net');
const { pathToFileURL } = require('node:url');
const [cli, port, token] = process.argv.slice(1);
const socket = net.createConnection({ host: '127.0.0.1', port: Number(port) });
socket.once('error', error => { console.error(error.message); process.exit(1); });
socket.once('connect', () => {
  socket.write(`${token}\n`);
  Object.defineProperty(process, 'stdin', { get: () => socket });
  Object.defineProperty(process, 'stdout', { get: () => socket });
  process.argv = [process.argv[0], cli, 'serve', '--stdio'];
  import(pathToFileURL(cli).href).catch(error => {
    console.error(error.stack); process.exit(1);
  });
});
