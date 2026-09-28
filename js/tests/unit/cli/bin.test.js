/**
 * Drives `bin/browser-commander.js` as a real process through command-stream
 * (issue #104). Only commands that need no browser run here; the browser
 * flows are in tests/e2e/cli.e2e.test.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

import { runCommand } from '../../../src/utilities/subprocess.js';

const BIN = fileURLToPath(
  new URL('../../../bin/browser-commander.js', import.meta.url)
);

function browserCommander(args, options = {}) {
  return runCommand(process.execPath, [BIN, ...args], {
    check: false,
    ...options,
  });
}

describe('bin/browser-commander.js', () => {
  it('prints the package version as one JSON document', async () => {
    const { code, stdout } = await browserCommander(['version']);

    assert.equal(code, 0);
    const document = JSON.parse(stdout);
    assert.equal(document.name, 'browser-commander');
    assert.equal(document.language, 'js');
    assert.match(document.version, /^\d+\.\d+\.\d+/u);
  });

  it('exits 64 with a JSON usage error', async () => {
    const { code, stdout } = await browserCommander(['bogus']);

    assert.equal(code, 64);
    assert.deepEqual(JSON.parse(stdout), {
      error: { name: 'UsageError', message: 'Unknown command "bogus"' },
    });
  });

  it('serves JSON-RPC on stdin until it closes', async () => {
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'version' },
      { jsonrpc: '2.0', id: 2, method: 'no.such.method' },
    ]
      .map((request) => `${JSON.stringify(request)}\n`)
      .join('');

    const { code, stdout } = await browserCommander(['serve', '--stdio'], {
      input,
    });

    assert.equal(code, 0);
    const responses = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .sort((a, b) => a.id - b.id);
    assert.equal(responses.length, 2);
    assert.equal(responses[0].result.name, 'browser-commander');
    assert.deepEqual(responses[1], {
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32601, message: 'Unknown method: no.such.method' },
    });
  });
});
