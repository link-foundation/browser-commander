import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  defaultFillVerification,
  verifyFill,
  checkIfElementEmpty,
  performFill,
  fillTextArea,
} from '../../../src/interactions/fill.js';
import {
  createMockPlaywrightPage,
  createMockLogger,
} from '../../helpers/mocks.js';

describe('fill', () => {
  describe('defaultFillVerification', () => {
    it('should verify exact match', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {
        inputValue: async () => 'test value',
      };

      const result = await defaultFillVerification({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        expectedText: 'test value',
      });

      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.actualValue, 'test value');
    });

    it('should verify partial match', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {
        inputValue: async () => 'test value with extra',
      };

      const result = await defaultFillVerification({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        expectedText: 'test value',
      });

      assert.strictEqual(result.verified, true);
    });

    it('should fail verification on mismatch', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {
        inputValue: async () => 'different value',
      };

      const result = await defaultFillVerification({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        expectedText: 'expected value',
      });

      assert.strictEqual(result.verified, false);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      // Override the locator method to return a locator that throws navigation error
      page.locator = () => ({
        inputValue: async () => {
          throw new Error('Execution context was destroyed');
        },
      });

      const result = await defaultFillVerification({
        page,
        engine: 'playwright',
        locatorOrElement: page.locator(),
        expectedText: 'test',
      });

      // Note: getInputValue catches navigation errors and returns '',
      // so defaultFillVerification sees '' as actualValue and verification fails
      // The navigation error is handled at the getInputValue level
      assert.strictEqual(result.verified, false);
      assert.strictEqual(result.actualValue, '');
    });
  });

  describe('verifyFill', () => {
    it('should verify fill with retry logic', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const mockLocator = {};

      const result = await verifyFill({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        expectedText: 'test',
        verifyFn: async () => ({ verified: true, actualValue: 'test' }),
        timeout: 100,
        log,
      });

      assert.strictEqual(result.verified, true);
      assert.ok(result.attempts >= 1);
    });

    it('should fail after timeout', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();

      const result = await verifyFill({
        page,
        engine: 'playwright',
        locatorOrElement: {},
        expectedText: 'expected',
        verifyFn: async () => ({ verified: false, actualValue: 'different' }),
        timeout: 50,
        retryInterval: 10,
        log,
      });

      assert.strictEqual(result.verified, false);
      assert.ok(result.attempts >= 1);
    });
  });

  describe('checkIfElementEmpty', () => {
    it('should throw when locatorOrElement is not provided', async () => {
      const page = createMockPlaywrightPage();

      await assert.rejects(
        () => checkIfElementEmpty({ page, engine: 'playwright' }),
        /locatorOrElement is required/
      );
    });

    it('should throw when page is not provided and no adapter', async () => {
      await assert.rejects(
        () =>
          checkIfElementEmpty({ engine: 'playwright', locatorOrElement: {} }),
        /page is required/
      );
    });

    it('should return true for empty element', async () => {
      const page = createMockPlaywrightPage();
      const adapter = {
        getInputValue: async () => '',
      };

      const result = await checkIfElementEmpty({
        page,
        engine: 'playwright',
        locatorOrElement: {},
        adapter,
      });

      assert.strictEqual(result, true);
    });

    it('should return true for whitespace-only element', async () => {
      const page = createMockPlaywrightPage();
      const adapter = {
        getInputValue: async () => '   ',
      };

      const result = await checkIfElementEmpty({
        page,
        engine: 'playwright',
        locatorOrElement: {},
        adapter,
      });

      assert.strictEqual(result, true);
    });

    it('should return false for element with content', async () => {
      const page = createMockPlaywrightPage();
      const adapter = {
        getInputValue: async () => 'some content',
      };

      const result = await checkIfElementEmpty({
        page,
        engine: 'playwright',
        locatorOrElement: {},
        adapter,
      });

      assert.strictEqual(result, false);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      const adapter = {
        getInputValue: async () => {
          throw new Error('Execution context was destroyed');
        },
      };

      const result = await checkIfElementEmpty({
        page,
        engine: 'playwright',
        locatorOrElement: {},
        adapter,
      });

      assert.strictEqual(result, true);
    });
  });

  describe('performFill', () => {
    it('should throw when text is not provided', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();

      await assert.rejects(
        () =>
          performFill({
            page,
            engine: 'playwright',
            locatorOrElement: {},
            log,
          }),
        /text is required/
      );
    });

    it('should throw when locatorOrElement is not provided', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();

      await assert.rejects(
        () =>
          performFill({
            page,
            engine: 'playwright',
            text: 'test',
            log,
          }),
        /locatorOrElement is required/
      );
    });

    it('should fill with typing simulation', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      let typeCalled = false;
      const adapter = {
        type: async (el, text) => {
          typeCalled = true;
        },
        getInputValue: async () => 'test text',
      };

      const result = await performFill({
        page,
        engine: 'playwright',
        locatorOrElement: {},
        text: 'test text',
        simulateTyping: true,
        verify: false,
        log,
        adapter,
      });

      assert.strictEqual(result.filled, true);
      assert.strictEqual(typeCalled, true);
    });

    it('should fill without typing simulation', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      let fillCalled = false;
      const adapter = {
        fill: async (el, text) => {
          fillCalled = true;
        },
        getInputValue: async () => 'test text',
      };

      const result = await performFill({
        page,
        engine: 'playwright',
        locatorOrElement: {},
        text: 'test text',
        simulateTyping: false,
        verify: false,
        log,
        adapter,
      });

      assert.strictEqual(result.filled, true);
      assert.strictEqual(fillCalled, true);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const adapter = {
        type: async () => {
          throw new Error('Execution context was destroyed');
        },
      };

      const result = await performFill({
        page,
        engine: 'playwright',
        locatorOrElement: {},
        text: 'test',
        simulateTyping: true,
        verify: false,
        log,
        adapter,
      });

      assert.strictEqual(result.filled, false);
    });
  });

  describe('fillTextArea', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const wait = async () => {};

      await assert.rejects(
        () =>
          fillTextArea({
            page,
            engine: 'playwright',
            log,
            wait,
            text: 'test',
          }),
        /selector and text are required/
      );
    });

    it('should throw when text is not provided', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const wait = async () => {};

      await assert.rejects(
        () =>
          fillTextArea({
            page,
            engine: 'playwright',
            log,
            wait,
            selector: 'textarea',
          }),
        /selector and text are required/
      );
    });

    it('should throw when page is not provided', async () => {
      const log = createMockLogger();
      const wait = async () => {};

      await assert.rejects(
        () =>
          fillTextArea({
            engine: 'playwright',
            log,
            wait,
            selector: 'textarea',
            text: 'test',
          }),
        /page is required/
      );
    });
  });
});
