import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationManager } from '../../../src/core/navigation-manager.js';
import { goto } from '../../../src/browser/navigation.js';
import { createNetworkTracker } from '../../../src/core/network-tracker.js';
import {
  createMockPlaywrightPage,
  createMockLogger,
} from '../../helpers/mocks.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const noWait = {
  waitForStableUrlBefore: false,
  waitForStableUrlAfter: false,
  waitForNetworkIdle: false,
  verify: false,
};

it('managed goto honors every no-wait option and keeps tracking', async () => {
  const page = createMockPlaywrightPage();
  let idleCalls = 0;
  const manager = createNavigationManager({
    page,
    engine: 'playwright',
    log: createMockLogger(),
    networkTracker: {
      reset() {},
      waitForNetworkIdle: async () => {
        idleCalls++;
        await delay(80);
        return true;
      },
    },
  });
  const started = performance.now();
  const result = await goto({
    page,
    navigationManager: manager,
    url: 'data:text/html,<h1>fixture</h1>',
    timeout: 50,
    ...noWait,
  });
  assert.equal(result.navigated, true);
  assert.equal(idleCalls, 0);
  assert.ok(performance.now() - started < 70);
  assert.equal(manager.getSessionId(), 1);
});

it('engine navigation and stalled readiness share a single budget', async () => {
  const page = createMockPlaywrightPage();
  page.goto = async () => delay(30);
  const manager = createNavigationManager({
    page,
    engine: 'playwright',
    log: createMockLogger(),
  });
  const started = performance.now();
  const result = await goto({
    page,
    navigationManager: manager,
    url: 'data:text/html,fixture',
    timeout: 60,
    ...noWait,
    checks: [{ name: 'stall', run: async () => new Promise(() => {}) }],
  });
  assert.equal(result.status, 'timed_out');
  assert.ok(performance.now() - started < 100);
  assert.equal(manager.isNavigating(), false);
});

it('caller abort promptly interrupts and unregisters its listener', async () => {
  const page = createMockPlaywrightPage();
  page.goto = async () => delay(180);
  const manager = createNavigationManager({
    page,
    engine: 'playwright',
    log: createMockLogger(),
  });
  const controller = new AbortController();
  let listeners = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => {
    listeners++;
    return add(...args);
  };
  controller.signal.removeEventListener = (...args) => {
    listeners--;
    return remove(...args);
  };
  const pending = goto({
    page,
    navigationManager: manager,
    url: 'data:text/html,fixture',
    timeout: 1000,
    signal: controller.signal,
    ...noWait,
  });
  setTimeout(() => controller.abort(), 20);
  const result = await pending;
  assert.equal(result.status, 'interrupted');
  assert.equal(listeners, 0);
  assert.equal(manager.isNavigating(), false);
});

it('an idle network wait respects a shorter timeout than its quiet period', async () => {
  const page = createMockPlaywrightPage();
  const tracker = createNetworkTracker({
    page,
    engine: 'playwright',
    log: createMockLogger(),
  });
  const started = performance.now();
  assert.equal(
    await tracker.waitForNetworkIdle({ timeout: 30, idleTime: 100 }),
    false
  );
  assert.ok(performance.now() - started < 80);
});
