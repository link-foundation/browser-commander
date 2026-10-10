import { it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPageTriggerManager } from '../../../src/core/page-trigger-manager.js';

const flush = () => new Promise((resolve) => globalThis.setImmediate(resolve));

for (const concurrency of ['skip', 'queue', 'restart']) {
  it(`retains DOM-ready work during stop (${concurrency})`, async () => {
    const navigationManager = new EventEmitter();
    const page = new EventEmitter();
    page.url = () => 'https://example.test/new';
    const manager = createPageTriggerManager({
      navigationManager,
      log: { debug() {} },
      stopGraceMs: 20,
    });
    const calls = [];
    let release;
    manager.pageTrigger({
      condition: () => true,
      readyOn: 'domcontentloaded',
      concurrency,
      action: async (ctx) => {
        calls.push(ctx.url);
        if (calls.length === 1) {
          await new Promise((resolve) => {
            release = resolve;
          });
        }
      },
    });
    manager.initialize({ page });
    page.emit('domcontentloaded');
    await flush();
    const stopping = manager.stopCurrentAction();
    page.emit('domcontentloaded');
    await stopping;
    assert.equal(calls.length, 1, 'grace expiry must never overlap actions');
    release();
    await flush();
    await flush();
    assert.equal(calls.length, 2, 'ready event survives grace expiry');
    await manager.destroy();
  });
}

it('queue coalesces repeated events and unregister cancels pending work', async () => {
  const nav = new EventEmitter();
  const page = new EventEmitter();
  page.url = () => 'https://example.test/';
  const manager = createPageTriggerManager({
    navigationManager: nav,
    log: { debug() {} },
  });
  let release;
  let count = 0;
  const remove = manager.pageTrigger({
    condition: () => true,
    concurrency: 'queue',
    action: async () => {
      count++;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  manager.initialize({ page });
  nav.emit('onPageReady', { url: page.url() });
  await flush();
  for (let i = 0; i < 20; i++) {
    nav.emit('onPageReady', { url: page.url() });
  }
  await flush();
  remove();
  release();
  await flush();
  assert.equal(count, 1);
  await manager.destroy();
});
