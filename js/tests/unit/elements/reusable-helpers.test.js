import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../../src/index.js';
import {
  createMockPlaywrightPage,
  createMockLogger,
} from '../../helpers/mocks.js';

it('finds ordered fallback selectors and supports alternate toggle texts', async () => {
  const commander = api.makeBrowserCommander({
    page: createMockPlaywrightPage({
      elements: {
        '#absent': { count: 0 },
        '#present': { count: 1, visible: true },
      },
    }),
    engine: 'playwright',
    log: createMockLogger(),
    enableNavigationManager: false,
  });
  assert.equal(
    await commander.findFirst({
      selectors: ['#absent', '#present'],
      visible: true,
    }),
    '#present'
  );
  const found = await api.findToggleButton({
    texts: ['one', 'two'],
    elementTypes: ['button'],
    count: async ({ selector }) => (selector === 'two' ? 1 : 0),
    findByText: async ({ text }) => text,
  });
  assert.equal(found, 'two');
  commander.destroy();
});

it('navigation subscriptions return idempotent unregister functions', () => {
  const commander = api.makeBrowserCommander({
    page: createMockPlaywrightPage(),
    engine: 'playwright',
  });
  for (const event of [
    'onUrlChange',
    'onNavigationStart',
    'onNavigationComplete',
    'onPageReady',
  ]) {
    const unregister = commander[event](() => {});
    assert.equal(typeof unregister, 'function');
    unregister();
    unregister();
  }
  commander.destroy();
});

it('exposes reusable text, checkbox, flag and cookie helpers', () => {
  for (const name of [
    'hasText',
    'isChecked',
    'check',
    'readFlag',
    'uninstallClickListener',
    'setCookies',
    'clearCookies',
  ]) {
    assert.equal(typeof api[name], 'function', name);
  }
});

it('unsubscribe retains a second registration of the same callback', async () => {
  const { subscribeCallbacks } =
    await import('../../../src/core/subscriptions.js');
  const callbacks = [],
    callback = () => {};
  const first = subscribeCallbacks(callbacks, callback);
  const second = subscribeCallbacks(callbacks, callback);
  first();
  first();
  assert.deepEqual(callbacks, [callback]);
  second();
  assert.deepEqual(callbacks, []);
});
