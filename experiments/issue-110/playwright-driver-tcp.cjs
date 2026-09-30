// Keep run-driver in the owned command-stream process while transporting its
// length-prefixed binary protocol without command-stream's UTF-8 output decoder.
const net = require('node:net');
const [cli, port, token] = process.argv.slice(2);
const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
socket.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
socket.once('connect', () => {
  socket.write(`${token}\n`);
  Object.defineProperty(process, 'stdin', { value: socket });
  Object.defineProperty(process, 'stdout', { value: socket });
  process.argv = [process.execPath, cli, 'run-driver'];
  require(cli);
});
