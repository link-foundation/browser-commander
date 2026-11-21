// Copied into a fresh consumer by check-consumer.sh; use only published exports.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { $ } from 'command-stream';
import {
  makeConfig,
  Parser as ConfigParser,
  parseLinoArguments,
} from 'lino-arguments';
import { Link, Parser, StreamParser } from 'links-notation';
import {
  formatTraceLinks,
  traceLinks,
  writeTraceLinks,
} from 'browser-commander';

const lock = JSON.parse(await fs.readFile('package-lock.json', 'utf8'));
const require = createRequire(import.meta.url);
const commanderRequire = createRequire(require.resolve('browser-commander'));
const installed = Object.keys(lock.packages);
for (const dependency of ['command-stream', 'links-notation']) {
  assert.equal(
    commanderRequire.resolve(dependency),
    require.resolve(dependency),
    `Browser Commander and the consumer must share ${dependency}`
  );
}
assert.deepEqual(
  installed.filter((name) => name.endsWith('/command-stream')),
  ['node_modules/command-stream']
);
for (const peer of ['@xterm/headless', '@resvg/resvg-js']) {
  assert.ok(
    !installed.some((name) => name.endsWith(`/${peer}`)),
    `${peer} must be opt-in`
  );
}

const bin = path.resolve(
  'node_modules/browser-commander/bin/browser-commander.js'
);
const cli = await $({ mirror: false })`${process.execPath} ${bin} version`;
assert.equal(cli.code, 0);
assert.equal(JSON.parse(cli.stdout).name, 'browser-commander');

assert.equal(ConfigParser, Parser);
await fs.writeFile(
  'release options.lenv',
  'RELEASE_VERSION: 0.34.0\nREPOSITORY: link-foundation/browser-commander\n'
);
const args = parseLinoArguments(
  '(\n  (--configuration "release options.lenv")\n  (--release-version 0.35.0)\n)'
);
const config = makeConfig({
  argv: [process.execPath, 'consumer.mjs', ...args],
  env: { values: {} },
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('release-version', {
        type: 'string',
        default: getenv('RELEASE_VERSION', ''),
      })
      .option('repository', {
        type: 'string',
        default: getenv('REPOSITORY', ''),
      }),
});
assert.equal(config.releaseVersion, '0.35.0');
assert.equal(config.repository, 'link-foundation/browser-commander');

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
  'Shared dependencies, shell CLI, Links Notation config and trace round trips pass.'
);
