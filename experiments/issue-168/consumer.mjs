// Copied into a fresh consumer by check-consumer.sh; use only published exports.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Link, Parser, StreamParser } from 'links-notation';
import {
  formatTraceLinks,
  traceLinks,
  writeTraceLinks,
} from 'browser-commander';

const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const copies = Object.entries(lock.packages)
  .filter(([name]) => name.endsWith('/links-notation'))
  .map(([name, entry]) => ({ path: name, version: entry.version }));
console.log(JSON.stringify({ copies }));
assert.deepEqual(copies, [
  { path: 'node_modules/links-notation', version: '0.25.2' },
]);

const require = createRequire(import.meta.url);
const commanderRequire = createRequire(require.resolve('browser-commander'));
assert.equal(
  commanderRequire.resolve('links-notation'),
  require.resolve('links-notation'),
  'Browser Commander and the consumer must load the same notation module'
);

const fixture = process.argv[2];
const links = await traceLinks(path.join(fixture, 'bundle'));
assert.ok(links.length > 0);
assert.ok(links.every((link) => link instanceof Link));
const text = formatTraceLinks(links);
const golden = (
  await fs.readFile(path.join(fixture, 'trace.lino'), 'utf8')
).replaceAll('\r\n', '\n');
assert.equal(text, golden);

const parsed = new Parser().parse(text);
assert.deepEqual(parsed, links);
const stream = new StreamParser();
for (let offset = 0; offset < text.length; offset += 17) {
  stream.write(text.slice(offset, offset + 17));
}
stream.end();
assert.deepEqual(stream.drain(), parsed);

const file = await writeTraceLinks(
  path.join(fixture, 'bundle'),
  path.resolve('export.lino')
);
assert.equal(await fs.readFile(file, 'utf8'), text);
console.log(
  'Shared Link identity, golden export, file export and streaming import pass.'
);
