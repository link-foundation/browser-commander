import { it } from 'node:test';
import assert from 'node:assert/strict';
import { count } from '../../../src/elements/visibility.js';

it('counts only visible matches when requested', async () => {
  const locator = {
    count: async () => 3,
    evaluateAll: async (fn) =>
      fn([
        { getClientRects: () => [1], checkVisibility: () => true },
        { getClientRects: () => [], checkVisibility: () => false },
        { getClientRects: () => [1], checkVisibility: () => true },
      ]),
  };
  assert.equal(
    await count({
      page: { locator: () => locator },
      engine: 'playwright',
      selector: 'div',
      visible: true,
    }),
    2
  );
});
