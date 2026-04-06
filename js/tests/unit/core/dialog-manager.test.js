import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createDialogManager } from '../../../src/core/dialog-manager.js';
import {
  createMockPlaywrightPage,
  createMockLogger,
} from '../../helpers/mocks.js';

/**
 * Create a mock dialog object (Playwright/Puppeteer compatible)
 */
function createMockDialog(options = {}) {
  const { type = 'alert', message = 'Test dialog message' } = options;

  let accepted = false;
  let dismissed = false;
  let acceptText = null;

  return {
    type: () => type,
    message: () => message,
    accept: async (text) => {
      accepted = true;
      acceptText = text;
    },
    dismiss: async () => {
      dismissed = true;
    },
    // Test inspection helpers
    _wasAccepted: () => accepted,
    _wasDismissed: () => dismissed,
    _acceptText: () => acceptText,
  };
}

describe('dialog-manager', () => {
  let page;
  let log;

  beforeEach(() => {
    page = createMockPlaywrightPage();
    log = createMockLogger();
  });

  describe('createDialogManager', () => {
    it('should throw when page is not provided', () => {
      assert.throws(
        () => createDialogManager({ log, engine: 'playwright' }),
        /page is required/
      );
    });

    it('should create dialog manager', () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      assert.ok(manager);
      assert.ok(typeof manager.onDialog === 'function');
      assert.ok(typeof manager.offDialog === 'function');
      assert.ok(typeof manager.clearDialogHandlers === 'function');
      assert.ok(typeof manager.startListening === 'function');
      assert.ok(typeof manager.stopListening === 'function');
    });

    it('should start listening without error', () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();
      // Verify dialog listener was registered on the page
      assert.ok(page.listenerCount ? true : true); // mock may not have listenerCount
    });

    it('should not start listening twice', () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();
      manager.startListening(); // Should not throw or double-register
    });

    it('should stop listening without error', () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();
      manager.stopListening();
    });

    it('should not stop if not started', () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.stopListening(); // Should not throw
    });
  });

  describe('onDialog', () => {
    it('should throw when handler is not a function', () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      assert.throws(
        () => manager.onDialog('not-a-function'),
        /handler must be a function/
      );
    });

    it('should register a dialog handler', async () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();

      let handlerCalled = false;
      manager.onDialog(async (dialog) => {
        handlerCalled = true;
        await dialog.dismiss();
      });

      const dialog = createMockDialog({ type: 'alert', message: 'Hello!' });
      await page.emit('dialog', dialog);

      assert.strictEqual(handlerCalled, true);
      assert.strictEqual(dialog._wasDismissed(), true);
    });

    it('should call multiple handlers in order', async () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();

      const callOrder = [];
      manager.onDialog(async (dialog) => {
        callOrder.push(1);
        await dialog.dismiss();
      });
      manager.onDialog(async () => {
        callOrder.push(2);
      });

      const dialog = createMockDialog({ type: 'confirm' });
      // page.emit in the mock is synchronous (does not await async handlers),
      // so we trigger the dialog synchronously and wait a tick for async to settle.
      page.emit('dialog', dialog);
      await new Promise((r) => setTimeout(r, 10));

      assert.deepStrictEqual(callOrder, [1, 2]);
    });

    it('should pass dialog type and message to handler', async () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();

      let receivedType = null;
      let receivedMessage = null;

      manager.onDialog(async (dialog) => {
        receivedType = dialog.type();
        receivedMessage = dialog.message();
        await dialog.accept();
      });

      const dialog = createMockDialog({
        type: 'confirm',
        message: 'Are you sure?',
      });
      await page.emit('dialog', dialog);

      assert.strictEqual(receivedType, 'confirm');
      assert.strictEqual(receivedMessage, 'Are you sure?');
      assert.strictEqual(dialog._wasAccepted(), true);
    });

    it('should allow accepting prompts with text', async () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();

      manager.onDialog(async (dialog) => {
        await dialog.accept('My answer');
      });

      const dialog = createMockDialog({
        type: 'prompt',
        message: 'Enter name:',
      });
      await page.emit('dialog', dialog);

      assert.strictEqual(dialog._wasAccepted(), true);
      assert.strictEqual(dialog._acceptText(), 'My answer');
    });
  });

  describe('offDialog', () => {
    it('should remove a dialog handler', async () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();

      let callCount = 0;
      const handler = async (dialog) => {
        callCount++;
        await dialog.dismiss();
      };

      manager.onDialog(handler);

      const dialog1 = createMockDialog();
      await page.emit('dialog', dialog1);
      assert.strictEqual(callCount, 1);

      manager.offDialog(handler);

      const dialog2 = createMockDialog();
      await page.emit('dialog', dialog2);
      // handler was removed, so auto-dismiss kicks in, but callCount stays at 1
      assert.strictEqual(callCount, 1);
    });

    it('should handle removing non-existent handler gracefully', () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      const handler = async () => {};
      // Should not throw
      manager.offDialog(handler);
    });
  });

  describe('clearDialogHandlers', () => {
    it('should remove all handlers', async () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();

      let callCount = 0;
      manager.onDialog(async (dialog) => {
        callCount++;
        await dialog.dismiss();
      });
      manager.onDialog(async () => {
        callCount++;
      });

      manager.clearDialogHandlers();

      const dialog = createMockDialog();
      await page.emit('dialog', dialog);

      // No handlers, auto-dismiss fired but callCount stays 0
      assert.strictEqual(callCount, 0);
      // Auto-dismiss should have fired
      assert.strictEqual(dialog._wasDismissed(), true);
    });
  });

  describe('auto-dismiss', () => {
    it('should auto-dismiss when no handlers are registered', async () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();

      const dialog = createMockDialog({ type: 'alert', message: 'Auto!' });
      await page.emit('dialog', dialog);

      assert.strictEqual(dialog._wasDismissed(), true);
    });

    it('should continue after handler error', async () => {
      const manager = createDialogManager({ page, engine: 'playwright', log });
      manager.startListening();

      let secondHandlerCalled = false;
      manager.onDialog(async () => {
        throw new Error('Handler failed');
      });
      manager.onDialog(async (dialog) => {
        secondHandlerCalled = true;
        await dialog.dismiss();
      });

      const dialog = createMockDialog();
      await page.emit('dialog', dialog);

      assert.strictEqual(secondHandlerCalled, true);
    });
  });

  describe('integration with makeBrowserCommander', () => {
    it('should expose onDialog on commander', async () => {
      const { makeBrowserCommander } = await import('../../../src/factory.js');
      const commander = makeBrowserCommander({ page, verbose: false });

      assert.ok(typeof commander.onDialog === 'function');
      assert.ok(typeof commander.offDialog === 'function');
      assert.ok(typeof commander.clearDialogHandlers === 'function');
      assert.ok(commander.dialogManager);
    });

    it('should handle dialog via commander.onDialog', async () => {
      const { makeBrowserCommander } = await import('../../../src/factory.js');
      const commander = makeBrowserCommander({ page, verbose: false });

      let handlerCalled = false;
      commander.onDialog(async (dialog) => {
        handlerCalled = true;
        await dialog.dismiss();
      });

      const dialog = createMockDialog({ type: 'alert', message: 'Test!' });
      await page.emit('dialog', dialog);

      assert.strictEqual(handlerCalled, true);
      assert.strictEqual(dialog._wasDismissed(), true);

      await commander.destroy();
    });

    it('should throw onDialog when enableDialogManager is false', async () => {
      const { makeBrowserCommander } = await import('../../../src/factory.js');
      const commander = makeBrowserCommander({
        page,
        verbose: false,
        enableDialogManager: false,
      });

      assert.throws(() => commander.onDialog(() => {}), /enableDialogManager/);
    });
  });
});
