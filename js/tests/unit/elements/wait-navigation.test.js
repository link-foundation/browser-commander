import { it } from 'node:test';
import assert from 'node:assert/strict';
import { waitForLocatorOrElement } from '../../../src/elements/locators.js';
import { waitForSelector } from '../../../src/elements/selectors.js';

for (const wait of [waitForLocatorOrElement, waitForSelector]) {
  it(`${wait.name} treats a timeout after navigation as interrupted`, async () => {
    let url = 'https://example.test/form';
    const locator = {
      first() {
        return this;
      },
      async waitFor() {
        url = 'https://example.test/sent';
        throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      },
    };
    const result = await wait({
      page: { url: () => url, locator: () => locator },
      engine: 'playwright',
      selector: 'button',
      throwOnNavigation: false,
    });
    assert.ok(result === null || result === false);
  });
}
