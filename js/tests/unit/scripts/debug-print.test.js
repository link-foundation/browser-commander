import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  debugWith,
  formatDebugLines,
  isDebugEnabled,
  readEnvVar,
} from '../../../../scripts/debug-print.mjs';

describe('debug-print', () => {
  it('stays off by default so release logs are not noisy', () => {
    assert.equal(isDebugEnabled({}), false);
    assert.equal(isDebugEnabled({ CI_SCRIPTS_DEBUG: '0' }), false);
    assert.equal(isDebugEnabled({ CI_SCRIPTS_DEBUG: '' }), false);
  });

  it('turns on through the local toggle or either Actions debug switch', () => {
    assert.equal(isDebugEnabled({ CI_SCRIPTS_DEBUG: '1' }), true);
    assert.equal(isDebugEnabled({ CI_SCRIPTS_DEBUG: 'true' }), true);
    assert.equal(isDebugEnabled({ RUNNER_DEBUG: '1' }), true);
    assert.equal(isDebugEnabled({ ACTIONS_STEP_DEBUG: 'true' }), true);
  });

  it('prefixes every line so Actions renders it in the debug stream', () => {
    assert.deepEqual(formatDebugLines(['a\nb']), ['::debug::a', '::debug::b']);
    assert.deepEqual(formatDebugLines(['keys', { a: 1 }]), [
      '::debug::keys {',
      '::debug::  "a": 1',
      '::debug::}',
    ]);
  });

  it('prints nothing when debug output is off', () => {
    const printed = [];
    assert.deepEqual(
      debugWith({ env: {}, log: (l) => printed.push(l) }, 'x'),
      []
    );
    assert.deepEqual(printed, []);
  });

  it('prints through the injected logger when debug output is on', () => {
    const printed = [];
    debugWith(
      { env: { CI_SCRIPTS_DEBUG: '1' }, log: (line) => printed.push(line) },
      'loaded',
      { keys: ['default'] }
    );
    assert.equal(printed[0], '::debug::loaded {');
  });

  it('treats an unreadable environment as unset instead of throwing', () => {
    // Deno raises NotCapable on the property read when --allow-env is absent;
    // tracing must never be the reason a script fails.
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('NotCapable');
        },
      }
    );
    assert.equal(readEnvVar('CI_SCRIPTS_DEBUG', hostile), undefined);
    assert.equal(isDebugEnabled(hostile), false);
  });
});
