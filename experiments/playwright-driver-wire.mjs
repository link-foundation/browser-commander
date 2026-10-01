// Experiment: speak the Playwright driver wire protocol directly
// (4-byte little-endian length + JSON) to confirm framing and metadata shape.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../js/package.json', import.meta.url));
const cli = require.resolve('playwright-core/package.json').replace(/package\.json$/, 'cli.js');
const driver = spawn(process.execPath, [cli, 'run-driver'], { stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = Buffer.alloc(0);
let id = 0;
const pending = new Map();
const send = (guid, method, params, metadata = {}) => {
  const message = Buffer.from(JSON.stringify({ id: ++id, guid, method, params, metadata }));
  const header = Buffer.alloc(4); header.writeUInt32LE(message.length);
  driver.stdin.write(Buffer.concat([header, message]));
  return new Promise((resolve) => pending.set(id, resolve));
};
driver.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const message = JSON.parse(buffer.subarray(4, 4 + length).toString());
    buffer = buffer.subarray(4 + length);
    if (message.id) pending.get(message.id)?.(message);
    else console.log('event', message.method, message.params?.type ?? '', message.params?.guid ?? message.guid);
  }
});
const init = await send('', 'initialize', { sdkLanguage: 'javascript' });
console.log('initialize ->', JSON.stringify(init).slice(0, 200));
const noMeta = await send('', 'initialize', { sdkLanguage: 'javascript' }, undefined);
console.log('without metadata ->', JSON.stringify(noMeta).slice(0, 300));
driver.stdin.end();
