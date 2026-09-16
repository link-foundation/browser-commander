import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CLICK_STATUS,
  CLICK_EFFECT,
  evidence,
  makeClickResult,
  nextActionId,
} from '../../../src/interactions/click-result.js';

describe('click result model', () => {
  it('should expose the documented status and effect vocabularies', () => {
    assert.deepStrictEqual(Object.values(CLICK_STATUS).sort(), [
      'failed',
      'interrupted',
      'succeeded',
      'timed_out',
      'unverified',
    ]);
    assert.deepStrictEqual(Object.values(CLICK_EFFECT).sort(), [
      'confirmed',
      'contradicted',
      'not-observed',
    ]);
  });

  it('should build evidence entries with a type and detail', () => {
    const entry = evidence('navigation', { urlChanged: true });
    assert.deepStrictEqual(entry, {
      type: 'navigation',
      detail: { urlChanged: true },
    });
    assert.deepStrictEqual(evidence('element-state').detail, {});
  });

  it('should derive verified only from confirmed effect', () => {
    // Regression test for issue #89: `verified` must never be true unless an
    // effect was actually observed.
    const confirmed = makeClickResult({
      status: CLICK_STATUS.SUCCEEDED,
      dispatched: true,
      effect: CLICK_EFFECT.CONFIRMED,
    });
    assert.strictEqual(confirmed.verified, true);

    for (const effect of [
      CLICK_EFFECT.NOT_OBSERVED,
      CLICK_EFFECT.CONTRADICTED,
    ]) {
      const result = makeClickResult({
        status: CLICK_STATUS.UNVERIFIED,
        dispatched: true,
        effect,
      });
      assert.strictEqual(result.verified, false, effect);
    }
  });

  it('should derive clicked from dispatched', () => {
    assert.strictEqual(makeClickResult({ dispatched: true }).clicked, true);
    assert.strictEqual(makeClickResult({ dispatched: false }).clicked, false);
    assert.strictEqual(makeClickResult({}).clicked, false);
  });

  it('should default to a conservative not-observed effect', () => {
    const result = makeClickResult({ status: CLICK_STATUS.UNVERIFIED });
    assert.strictEqual(result.effect, CLICK_EFFECT.NOT_OBSERVED);
    assert.strictEqual(result.verified, false);
    assert.strictEqual(result.navigated, false);
    assert.deepStrictEqual(result.evidence, []);
    assert.strictEqual(result.elapsedMs, 0);
  });

  it('should omit actionId unless one was supplied', () => {
    assert.ok(!('actionId' in makeClickResult({})));
    assert.strictEqual(makeClickResult({ actionId: 'a1' }).actionId, 'a1');
  });

  it('should carry extra fields through untouched', () => {
    const result = makeClickResult({ selector: '#go', ready: false });
    assert.strictEqual(result.selector, '#go');
    assert.strictEqual(result.ready, false);
  });

  it('should mint unique action ids for navigation correlation', () => {
    const ids = new Set(Array.from({ length: 200 }, () => nextActionId()));
    assert.strictEqual(ids.size, 200);
    assert.ok([...ids].every((id) => id.startsWith('click-')));
  });
});
