import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  waitForUrlCondition,
  installClickListener,
  checkAndClearFlag,
  findToggleButton,
} from '../../../src/high-level/universal-logic.js';

describe('universal-logic', () => {
  describe('waitForUrlCondition', () => {
    it('should return true when target URL is reached', async () => {
      let callCount = 0;
      const getUrl = () => {
        callCount++;
        if (callCount >= 2) {
          return 'https://example.com/target';
        }
        return 'https://example.com/start';
      };
      const wait = async () => {};

      const result = await waitForUrlCondition({
        getUrl,
        wait,
        targetUrl: 'https://example.com/target',
        pollingInterval: 1,
      });

      assert.strictEqual(result, true);
    });

    it('should return null when page is closed', async () => {
      let pageOpen = true;
      const getUrl = () => 'https://example.com/start';
      const wait = async () => { pageOpen = false; };
      const pageClosedCallback = () => !pageOpen;

      const result = await waitForUrlCondition({
        getUrl,
        wait,
        targetUrl: 'https://example.com/target',
        pageClosedCallback,
        pollingInterval: 1,
      });

      assert.strictEqual(result, null);
    });

    it('should return custom check result when provided', async () => {
      const getUrl = () => 'https://example.com/page';
      const wait = async () => {};
      let checkCalled = false;
      const customCheck = (url) => {
        checkCalled = true;
        return 'custom result';
      };

      const result = await waitForUrlCondition({
        getUrl,
        wait,
        customCheck,
        targetUrl: 'https://example.com/never',
        pollingInterval: 1,
      });

      assert.strictEqual(checkCalled, true);
      assert.strictEqual(result, 'custom result');
    });

    it('should continue when customCheck returns undefined', async () => {
      let callCount = 0;
      const getUrl = () => {
        callCount++;
        if (callCount >= 3) {
          return 'https://example.com/target';
        }
        return 'https://example.com/start';
      };
      const wait = async () => {};
      const customCheck = () => undefined;

      const result = await waitForUrlCondition({
        getUrl,
        wait,
        customCheck,
        targetUrl: 'https://example.com/target',
        pollingInterval: 1,
      });

      assert.strictEqual(result, true);
    });

    it('should handle errors gracefully', async () => {
      let errorThrown = false;
      let callCount = 0;
      const getUrl = () => {
        callCount++;
        if (callCount === 1 && !errorThrown) {
          errorThrown = true;
          throw new Error('Temporary error');
        }
        return 'https://example.com/target';
      };
      const wait = async () => {};

      const result = await waitForUrlCondition({
        getUrl,
        wait,
        targetUrl: 'https://example.com/target',
        pollingInterval: 1,
      });

      assert.strictEqual(result, true);
    });
  });

  describe('installClickListener', () => {
    it('should install click listener', async () => {
      let evaluateCalled = false;
      const evaluate = async ({ fn, args }) => {
        evaluateCalled = true;
      };

      const result = await installClickListener({
        evaluate,
        buttonText: 'Submit',
        storageKey: 'submitClicked',
      });

      assert.strictEqual(evaluateCalled, true);
      assert.strictEqual(result, true);
    });

    it('should return false on navigation error', async () => {
      const evaluate = async () => {
        throw new Error('Execution context was destroyed');
      };

      const result = await installClickListener({
        evaluate,
        buttonText: 'Submit',
        storageKey: 'submitClicked',
      });

      assert.strictEqual(result, false);
    });
  });

  describe('checkAndClearFlag', () => {
    it('should return true when flag is set', async () => {
      const evaluate = async ({ fn, args }) => true;

      const result = await checkAndClearFlag({
        evaluate,
        storageKey: 'submitClicked',
      });

      assert.strictEqual(result, true);
    });

    it('should return false when flag is not set', async () => {
      const evaluate = async ({ fn, args }) => false;

      const result = await checkAndClearFlag({
        evaluate,
        storageKey: 'submitClicked',
      });

      assert.strictEqual(result, false);
    });

    it('should return false on navigation error', async () => {
      const evaluate = async () => {
        throw new Error('Execution context was destroyed');
      };

      const result = await checkAndClearFlag({
        evaluate,
        storageKey: 'submitClicked',
      });

      assert.strictEqual(result, false);
    });
  });

  describe('findToggleButton', () => {
    it('should find button by data-qa selector', async () => {
      const count = async ({ selector }) => {
        if (selector === '[data-qa="toggle"]') return 1;
        return 0;
      };
      const findByText = async () => null;

      const result = await findToggleButton({
        count,
        findByText,
        dataQaSelectors: ['[data-qa="toggle"]'],
      });

      assert.strictEqual(result, '[data-qa="toggle"]');
    });

    it('should fallback to text search', async () => {
      const count = async ({ selector }) => {
        if (selector === 'button:has-text("Toggle")') return 1;
        return 0;
      };
      const findByText = async ({ text, selector }) => {
        if (text === 'Toggle' && selector === 'button') {
          return 'button:has-text("Toggle")';
        }
        return null;
      };

      const result = await findToggleButton({
        count,
        findByText,
        dataQaSelectors: [],
        textToFind: 'Toggle',
        elementTypes: ['button'],
      });

      assert.strictEqual(result, 'button:has-text("Toggle")');
    });

    it('should return null when button not found', async () => {
      const count = async () => 0;
      const findByText = async () => 'selector';

      const result = await findToggleButton({
        count,
        findByText,
        dataQaSelectors: [],
        textToFind: 'NonExistent',
      });

      assert.strictEqual(result, null);
    });

    it('should try multiple data-qa selectors', async () => {
      let selectorsTried = [];
      const count = async ({ selector }) => {
        selectorsTried.push(selector);
        if (selector === '[data-qa="toggle-3"]') return 1;
        return 0;
      };
      const findByText = async () => null;

      const result = await findToggleButton({
        count,
        findByText,
        dataQaSelectors: ['[data-qa="toggle-1"]', '[data-qa="toggle-2"]', '[data-qa="toggle-3"]'],
      });

      assert.ok(selectorsTried.includes('[data-qa="toggle-1"]'));
      assert.ok(selectorsTried.includes('[data-qa="toggle-2"]'));
      assert.strictEqual(result, '[data-qa="toggle-3"]');
    });

    it('should try multiple element types for text search', async () => {
      let typesTried = [];
      const count = async ({ selector }) => {
        if (selector === 'span:has-text("Toggle")') return 1;
        return 0;
      };
      const findByText = async ({ selector }) => {
        typesTried.push(selector);
        return `${selector}:has-text("Toggle")`;
      };

      const result = await findToggleButton({
        count,
        findByText,
        dataQaSelectors: [],
        textToFind: 'Toggle',
        elementTypes: ['button', 'a', 'span'],
      });

      assert.ok(typesTried.includes('button'));
      assert.ok(typesTried.includes('a'));
      assert.strictEqual(result, 'span:has-text("Toggle")');
    });
  });
});
