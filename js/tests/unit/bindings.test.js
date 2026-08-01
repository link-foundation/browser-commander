import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createBoundFunctions } from '../../src/bindings.js';
import {
  createMockPlaywrightPage,
  createMockLogger,
  createMockNavigationManager,
  createMockNetworkTracker,
} from '../helpers/mocks.js';

describe('bindings', () => {
  describe('createBoundFunctions', () => {
    it('should create bindings with minimal options', () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();

      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log,
      });

      assert.ok(bindings);
      assert.ok(typeof bindings === 'object');
    });

    it('should create bindings with all options', () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const navigationManager = createMockNavigationManager();
      const networkTracker = createMockNetworkTracker();

      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log,
        verbose: true,
        navigationManager,
        networkTracker,
      });

      assert.ok(bindings);
    });

    it('should have all expected bound functions', () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();

      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log,
      });

      // Verify it returns an object with functions
      assert.ok(bindings);
      assert.ok(typeof bindings === 'object');

      // Navigation
      assert.ok(
        typeof bindings.goto === 'function',
        'goto should be a function'
      );
      assert.ok(
        typeof bindings.getUrl === 'function',
        'getUrl should be a function'
      );
      assert.ok(
        typeof bindings.waitForNavigation === 'function',
        'waitForNavigation should be a function'
      );

      // Selectors
      assert.ok(
        typeof bindings.querySelector === 'function',
        'querySelector should be a function'
      );
      assert.ok(
        typeof bindings.querySelectorAll === 'function',
        'querySelectorAll should be a function'
      );
      assert.ok(
        typeof bindings.findByText === 'function',
        'findByText should be a function'
      );
      assert.ok(
        typeof bindings.waitForSelector === 'function',
        'waitForSelector should be a function'
      );

      // Interactions
      assert.ok(
        typeof bindings.clickButton === 'function',
        'clickButton should be a function'
      );
      assert.ok(
        typeof bindings.click === 'function',
        'click should be a function'
      );
      assert.ok(
        typeof bindings.fillTextArea === 'function',
        'fillTextArea should be a function'
      );
      assert.ok(
        typeof bindings.fill === 'function',
        'fill should be a function'
      );
      assert.ok(
        typeof bindings.scrollIntoViewIfNeeded === 'function',
        'scrollIntoViewIfNeeded should be a function'
      );

      // Element state
      assert.ok(
        typeof bindings.isVisible === 'function',
        'isVisible should be a function'
      );
      assert.ok(
        typeof bindings.isEnabled === 'function',
        'isEnabled should be a function'
      );
      assert.ok(
        typeof bindings.count === 'function',
        'count should be a function'
      );

      // Content
      assert.ok(
        typeof bindings.textContent === 'function',
        'textContent should be a function'
      );
      assert.ok(
        typeof bindings.content === 'function',
        'content should be a function'
      );
      assert.ok(
        typeof bindings.innerText === 'function',
        'innerText should be a function'
      );
      assert.ok(
        typeof bindings.inputValue === 'function',
        'inputValue should be a function'
      );
      assert.ok(
        typeof bindings.getAttribute === 'function',
        'getAttribute should be a function'
      );

      // Utilities
      assert.ok(
        typeof bindings.wait === 'function',
        'wait should be a function'
      );
      assert.ok(
        typeof bindings.evaluate === 'function',
        'evaluate should be a function'
      );

      // Keyboard - flat functions
      assert.ok(
        typeof bindings.pressKey === 'function',
        'pressKey should be a function'
      );
      assert.ok(
        typeof bindings.typeText === 'function',
        'typeText should be a function'
      );
      assert.ok(
        typeof bindings.keyDown === 'function',
        'keyDown should be a function'
      );
      assert.ok(
        typeof bindings.keyUp === 'function',
        'keyUp should be a function'
      );

      // Keyboard - object API
      assert.ok(
        bindings.keyboard && typeof bindings.keyboard === 'object',
        'keyboard should be an object'
      );
      assert.ok(
        typeof bindings.keyboard.press === 'function',
        'keyboard.press should be a function'
      );
      assert.ok(
        typeof bindings.keyboard.type === 'function',
        'keyboard.type should be a function'
      );
      assert.ok(
        typeof bindings.keyboard.down === 'function',
        'keyboard.down should be a function'
      );
      assert.ok(
        typeof bindings.keyboard.up === 'function',
        'keyboard.up should be a function'
      );
    });

    it('should pre-bind page and engine to functions', async () => {
      const page = createMockPlaywrightPage({ url: 'https://example.com' });
      const log = createMockLogger();

      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log,
      });

      // getUrl should work without passing page
      const url = bindings.getUrl();
      assert.strictEqual(url, 'https://example.com');
    });

    it('should expose page content with no arguments', async () => {
      const page = createMockPlaywrightPage();
      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log: createMockLogger(),
      });

      assert.strictEqual(
        await bindings.content(),
        '<html><body>Mock page</body></html>'
      );
    });

    it('should expose innerText with a selector or the body by default', async () => {
      const page = createMockPlaywrightPage({
        elements: {
          body: { innerText: 'Body text', count: 1 },
          main: { innerText: 'Main text', count: 1 },
        },
      });
      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log: createMockLogger(),
      });

      assert.strictEqual(await bindings.innerText(), 'Body text');
      assert.strictEqual(await bindings.innerText('main'), 'Main text');
    });

    it('should evaluate a function with positional arguments', async () => {
      const page = createMockPlaywrightPage();
      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log: createMockLogger(),
      });

      assert.strictEqual(await bindings.evaluate((a, b) => a + b, 2, 3), 5);
    });

    it('should preserve the evaluate options-object API', async () => {
      const page = createMockPlaywrightPage();
      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log: createMockLogger(),
      });

      assert.strictEqual(
        await bindings.evaluate({ fn: (a, b) => a + b, args: [2, 3] }),
        5
      );
    });

    it('should pre-bind log to functions', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger({ collectLogs: true });

      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log,
      });

      // wait should work without passing log
      await bindings.wait({ ms: 1 });
      // Should not throw
    });

    it('should allow verbose option', () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();

      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log,
        verbose: true,
      });

      assert.ok(bindings);
    });

    it('should integrate with navigationManager when provided', () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const navigationManager = createMockNavigationManager();

      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log,
        navigationManager,
      });

      assert.ok(bindings);
    });

    it('should invoke keyboard.press via bound keyboard object', async () => {
      const pressedKeys = [];
      const page = createMockPlaywrightPage();
      page.keyboard.press = async (key) => pressedKeys.push(key);
      const log = createMockLogger();

      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log,
      });

      await bindings.keyboard.press('Escape');
      assert.deepStrictEqual(pressedKeys, ['Escape']);
    });

    it('should invoke keyboard.type via bound keyboard object', async () => {
      const typedTexts = [];
      const page = createMockPlaywrightPage();
      page.keyboard.type = async (text) => typedTexts.push(text);
      const log = createMockLogger();

      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log,
      });

      await bindings.keyboard.type('hello world');
      assert.deepStrictEqual(typedTexts, ['hello world']);
    });

    it('should integrate with networkTracker when provided', () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const networkTracker = createMockNetworkTracker();

      const bindings = createBoundFunctions({
        page,
        engine: 'playwright',
        log,
        networkTracker,
      });

      assert.ok(bindings);
    });
  });
});
