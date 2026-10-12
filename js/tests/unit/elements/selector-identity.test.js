import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  normalizeSelector,
  withTextSelectorSupport,
} from '../../../src/elements/selectors.js';
import { createPlaywrightLocator } from '../../../src/elements/locators.js';

it('keeps native Playwright text selectors without an eager DOM lookup', async () => {
  const selector = '.parent button:has-text("B")';
  const page = {
    evaluate: () => {
      throw new Error('unexpected DOM lookup');
    },
  };
  assert.equal(
    await normalizeSelector({ page, engine: 'playwright', selector }),
    selector
  );
  const wrapped = withTextSelectorSupport(
    async ({ selector }) => selector,
    'playwright',
    page
  );
  assert.equal(await wrapped({ selector }), selector);
});

it('passes CSS nth-of-type to Playwright without changing its meaning', () => {
  const selector = 'section button:nth-of-type(2)';
  const expected = {};
  const page = {
    locator: (received) => {
      assert.equal(received, selector);
      return expected;
    },
  };
  assert.equal(createPlaywrightLocator({ page, selector }), expected);
});
