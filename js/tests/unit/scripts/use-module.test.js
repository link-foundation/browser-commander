import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeModule,
  loadCommandStream,
  loadLinoArguments,
  loadUse,
  resolveNamedExport,
  USE_M_URL,
} from '../../../../scripts/use-module.mjs';

const dollar = () => {};

function commandStreamExports() {
  return Object.assign(() => {}, { $: dollar, sh: () => {}, run: () => {} });
}

/**
 * Namespace `import()` produces for a CommonJS file on Node < 23. use-m unwraps
 * it because `default` is the only key, so `const { $ }` works. Measured on
 * node v20.20.2 and v22.21.1.
 */
function nodeTwentyTwoNamespace() {
  return { default: commandStreamExports() };
}

/**
 * The same file on Node 23+: the synthetic `module.exports` key makes use-m
 * skip the unwrap and hand the raw namespace to the caller. Measured on
 * node v24.20.0, the version every workflow in this repository requests.
 */
function nodeTwentyFourNamespace() {
  return {
    default: commandStreamExports(),
    'module.exports': commandStreamExports(),
  };
}

function textResponse(
  body,
  { ok = true, status = 200, statusText = 'OK' } = {}
) {
  return {
    ok,
    status,
    statusText,
    async text() {
      return body;
    },
  };
}

describe('use-module interop shim', () => {
  it('reproduces the Node 24 namespace that breaks destructuring', () => {
    // This is the CI failure verbatim: `$` is undefined, so the first tagged
    // template threw `TypeError: $ is not a function` in the release jobs.
    const { $ } = nodeTwentyFourNamespace();
    assert.equal($, undefined);
  });

  it('resolves $ from the Node 23+ CommonJS namespace', () => {
    const resolved = resolveNamedExport(
      nodeTwentyFourNamespace(),
      '$',
      'command-stream'
    );
    assert.equal(typeof resolved.$, 'function');
  });

  it('resolves $ from the Node < 23 CommonJS namespace', () => {
    const resolved = resolveNamedExport(
      nodeTwentyTwoNamespace(),
      '$',
      'command-stream'
    );
    assert.equal(typeof resolved.$, 'function');
  });

  it('resolves $ when use-m already unwrapped the module', () => {
    const resolved = resolveNamedExport(
      commandStreamExports(),
      '$',
      'command-stream'
    );
    assert.equal(typeof resolved.$, 'function');
  });

  it('resolves $ from a real ES module namespace with named exports', () => {
    const namespace = { $: dollar, sh: () => {}, default: dollar };
    assert.equal(
      resolveNamedExport(namespace, '$', 'command-stream'),
      namespace
    );
  });

  it('resolves a double-wrapped default', () => {
    const resolved = resolveNamedExport(
      { default: { default: commandStreamExports() } },
      '$',
      'command-stream'
    );
    assert.equal(typeof resolved.$, 'function');
  });

  it('names the observed keys when no candidate exposes the export', () => {
    assert.throws(
      () => resolveNamedExport({ nope: 1 }, '$', 'command-stream'),
      (error) =>
        error.message.includes("use('command-stream')") &&
        error.message.includes('keys [nope]')
    );
  });

  it('reports the received value when use-m resolved nothing', () => {
    assert.throws(
      () => resolveNamedExport(undefined, '$', 'command-stream'),
      /Received undefined/
    );
  });

  it('describes null, primitives and objects', () => {
    assert.equal(describeModule(null), 'null');
    assert.equal(describeModule(7), 'number');
    assert.equal(describeModule({ a: 1, b: 2 }), 'object with keys [a, b]');
  });

  it('loads command-stream through an injected use() implementation', async () => {
    const calls = [];
    const use = async (name) => {
      calls.push(name);
      return nodeTwentyFourNamespace();
    };
    const module = await loadCommandStream(use);
    assert.deepEqual(calls, ['command-stream']);
    assert.equal(typeof module.$, 'function');
  });

  it('loads lino-arguments through an injected use() implementation', async () => {
    const calls = [];
    const use = async (name) => {
      calls.push(name);
      return { default: { makeConfig: () => ({}) } };
    };
    const module = await loadLinoArguments(use);
    assert.deepEqual(calls, ['lino-arguments']);
    assert.equal(typeof module.makeConfig, 'function');
  });

  it('points at the unpinned use-m entry point', () => {
    assert.equal(USE_M_URL, 'https://unpkg.com/use-m/use.js');
  });

  it('reports the HTTP status when use.js cannot be fetched', async () => {
    // Without this the error page would be eval'd and surface as a SyntaxError.
    await assert.rejects(
      loadUse({
        fetchImpl: async () =>
          textResponse('<html>Not Found</html>', {
            ok: false,
            status: 404,
            statusText: 'Not Found',
          }),
      }),
      /404 Not Found/
    );
  });

  it('reports a use.js payload that exposes no callable use()', async () => {
    await assert.rejects(
      loadUse({ fetchImpl: async () => textResponse('({ nope: 1 })') }),
      /did not export a callable "use"/
    );
  });

  it('evaluates a well-formed use.js payload', async () => {
    const use = await loadUse({
      fetchImpl: async () => textResponse('({ use: async () => ({}) })'),
    });
    assert.equal(typeof use, 'function');
  });
});
