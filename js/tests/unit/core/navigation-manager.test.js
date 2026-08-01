import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createNavigationManager } from '../../../src/core/navigation-manager.js';
import {
  createMockPlaywrightPage,
  createMockLogger,
} from '../../helpers/mocks.js';

describe('navigation manager', () => {
  describe('setContent', () => {
    it('should apply the full managed navigation lifecycle', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const calls = [];
      page.setContent = async (...args) => calls.push(['setContent', ...args]);

      const manager = createNavigationManager({
        page,
        engine: 'playwright',
        log,
      });
      manager.configure({ redirectStabilizationTime: 0 });
      manager.onSessionCleanup(() => calls.push(['cleanup']));
      manager.on('onNavigationStart', () => calls.push(['navigationStart']));
      manager.on('onPageReady', () => calls.push(['pageReady']));

      const loaded = await manager.setContent({
        html: '<h1>Hi</h1>',
        waitUntil: 'networkidle',
        timeout: 5000,
      });

      assert.strictEqual(loaded, true);
      assert.strictEqual(manager.getSessionId(), 1);
      assert.strictEqual(manager.isNavigating(), false);
      assert.deepStrictEqual(calls, [
        ['cleanup'],
        ['navigationStart'],
        [
          'setContent',
          '<h1>Hi</h1>',
          { waitUntil: 'networkidle', timeout: 5000 },
        ],
        ['pageReady'],
      ]);
    });

    it('should require html while accepting an empty string', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const manager = createNavigationManager({
        page,
        engine: 'playwright',
        log,
      });
      manager.configure({ redirectStabilizationTime: 0 });

      await assert.rejects(() => manager.setContent(), /html is required/);
      await assert.doesNotReject(() => manager.setContent({ html: '' }));
    });
  });
});
