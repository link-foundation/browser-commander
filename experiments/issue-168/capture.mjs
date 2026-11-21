import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { captureTerminal } from 'command-stream';

const capture = await captureTerminal({
  file: process.execPath,
  args: ['node_modules/browser-commander/bin/browser-commander.js', 'version'],
  cols: 80,
  rows: 6,
  timeoutMilliseconds: 10000,
  artifactDirectory: 'recording',
  artifacts: ['cast', 'gif'],
});

assert.equal(capture.exitCode, 0);
assert.equal(JSON.parse(capture.output.trim()).name, 'browser-commander');
assert.ok(capture.frames.length > 0);
const [header, ...events] = (await readFile('recording/session.cast', 'utf8'))
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
assert.equal(header.version, 2);
assert.match(
  events
    .filter(([, code]) => code === 'o')
    .map(([, , data]) => data)
    .join(''),
  /browser-commander/u
);
const gif = await readFile('recording/recording.gif');
assert.equal(gif.toString('ascii', 0, 6), 'GIF89a');
assert.ok(gif.length > 6);
console.log(
  'Recorded the packaged CLI through a PTY and produced asciicast and GIF artifacts.'
);
