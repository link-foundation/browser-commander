import { it } from 'node:test';
import assert from 'node:assert/strict';
import { isNavigationError } from '../../../src/core/navigation-safety.js';
import { createManagedNavigator } from '../../../src/core/managed-navigation.js';

it('classifies net::ERR_ABORTED as an interrupted navigation outcome', async () => {
  const error = new Error(
    'page.goto: net::ERR_ABORTED at https://example.test/a'
  );
  assert.equal(isNavigationError(error), true);
  const goto = createManagedNavigator({
    page: {
      goto: async () => {
        throw error;
      },
    },
    state: {},
    config: {},
    triggerNavigationStart: async () => {},
    updateCurrentUrl() {},
    abandonNavigation() {},
    waitForReady: async () => ({ ready: true }),
  });
  assert.equal(
    (await goto({ url: 'https://example.test/a', returnOutcome: true })).status,
    'interrupted'
  );
  assert.equal(
    isNavigationError(new Error('net::ERR_NAME_NOT_RESOLVED')),
    false
  );
});
