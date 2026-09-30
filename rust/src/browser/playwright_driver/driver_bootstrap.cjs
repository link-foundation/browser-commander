// The official driver runs in this owned command-stream process. Its standard
// binary PipeTransport uses the authenticated socket as stdin/stdout.
const net = require('node:net');
const [cli, port, token] = process.argv.slice(1);
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
