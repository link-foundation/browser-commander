import { it } from 'node:test';
import assert from 'node:assert/strict';
import { clickButton } from '../../../src/interactions/click.js';

for (const change of ['url', 'session', 'none']) {
  it(`element timeout detects ${change} changes`, async () => {
    let url = 'https://example.com/form';
    let session = 1;
    const error = Object.assign(new Error('waitFor: Timeout 5000ms exceeded'), {
      name: 'TimeoutError',
    });
    const locator = {
      first: () => locator,
      waitFor: async () => {
        if (change === 'url') {
          url = 'https://example.com/done';
        }
        if (change === 'session') {
          session++;
        }
        throw error;
      },
    };
    const operation = clickButton({
      page: { url: () => url, locator: () => locator },
      engine: 'playwright',
      navigationManager: { getSessionId: () => session },
      selector: '#submit',
    });
    if (change === 'none') {
      await assert.rejects(operation, error);
    } else {
      const result = await operation;
      assert.equal(result.status, 'interrupted');
      assert.equal(result.navigated, true);
      assert.equal(result.dispatched, false);
    }
  });
}
