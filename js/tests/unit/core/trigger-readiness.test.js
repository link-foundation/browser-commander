import { EventEmitter } from 'node:events';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createPageTriggerManager } from '../../../src/core/page-trigger-manager.js';

it('DOM-ready triggers start without network idle and skip overlapping runs', async () => {
  const events = new EventEmitter();
  let release;
  let calls = 0;
  const manager = createPageTriggerManager({
    navigationManager: events,
    log: { debug() {} },
  });
  manager.pageTrigger({
    readyOn: 'domcontentloaded',
    concurrency: 'skip',
    condition: () => true,
    action: async () => {
      calls++;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const page = new EventEmitter();
  page.url = () => 'https://example.com/form';
  manager.initialize({ page });
  page.emit('domcontentloaded');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  page.emit('domcontentloaded');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await manager.destroy();
  assert.equal(page.listenerCount('domcontentloaded'), 0);
  assert.equal(events.listenerCount('onPageReady'), 0);
});
import { setImmediate } from 'node:timers';
