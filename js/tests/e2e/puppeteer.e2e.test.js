/**
 * E2E tests for browser-commander using Puppeteer engine
 *
 * Prerequisites:
 * 1. Start the React test app: cd examples/react-test-app && npm install && npm run dev
 * 2. Run tests: npm run test:e2e:puppeteer
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// Dynamic import for puppeteer since it may not be installed
let puppeteer;
let createCommander;

describe('E2E Tests - Puppeteer Engine', { skip: !process.env.RUN_E2E }, () => {
  let browser;
  let page;
  let commander;
  const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

  before(async () => {
    try {
      puppeteer = await import('puppeteer');
      const module = await import('../../src/index.js');
      createCommander = module.createCommander;

      browser = await puppeteer.default.launch({
        headless: process.env.HEADLESS !== 'false' ? 'new' : false,
      });
      page = await browser.newPage();
      commander = createCommander({ page, verbose: true });
    } catch (error) {
      console.log(
        'Skipping E2E tests - puppeteer not available or test app not running'
      );
      console.log('Error:', error.message);
    }
  });

  after(async () => {
    if (browser) {
      await browser.close();
    }
  });

  describe('Navigation', () => {
    it('should navigate to test app', async () => {
      if (!commander) {
        return;
      }

      await commander.goto({ url: BASE_URL });
      const url = commander.getUrl();
      assert.ok(url.includes('localhost:3000') || url.includes(BASE_URL));
    });

    it('should get page title', async () => {
      if (!commander) {
        return;
      }

      const title = await commander.textContent({
        selector: '[data-testid="page-title"]',
      });
      assert.strictEqual(title.trim(), 'React Test App');
    });
  });

  describe('Form Interactions', () => {
    it('should fill text input', async () => {
      if (!commander) {
        return;
      }

      await commander.fill({
        selector: '[data-testid="input-name"]',
        text: 'Jane Doe',
      });
      const value = await commander.inputValue({
        selector: '[data-testid="input-name"]',
      });
      assert.strictEqual(value, 'Jane Doe');
    });

    it('should fill email input', async () => {
      if (!commander) {
        return;
      }

      await commander.fill({
        selector: '[data-testid="input-email"]',
        text: 'jane@example.com',
      });
      const value = await commander.inputValue({
        selector: '[data-testid="input-email"]',
      });
      assert.strictEqual(value, 'jane@example.com');
    });

    it('should fill textarea', async () => {
      if (!commander) {
        return;
      }

      const bioText = 'This is my bio from Puppeteer test.';
      await commander.fill({
        selector: '[data-testid="textarea-bio"]',
        text: bioText,
      });
      const value = await commander.inputValue({
        selector: '[data-testid="textarea-bio"]',
      });
      assert.strictEqual(value, bioText);
    });

    it('should select radio button', async () => {
      if (!commander) {
        return;
      }

      await commander.click({ selector: '[data-testid="radio-female"]' });
      await commander.wait({ ms: 100 });
    });

    it('should check multiple checkboxes', async () => {
      if (!commander) {
        return;
      }

      await commander.click({ selector: '[data-testid="checkbox-sports"]' });
      await commander.click({ selector: '[data-testid="checkbox-music"]' });
      await commander.wait({ ms: 100 });
    });

    it('should select from dropdown', async () => {
      if (!commander) {
        return;
      }

      // Using evaluate to interact with select
      await commander.evaluate({
        fn: () => {
          const select = document.querySelector(
            '[data-testid="select-country"]'
          );
          if (select) {
            select.value = 'uk';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
      });
      const value = await commander.inputValue({
        selector: '[data-testid="select-country"]',
      });
      assert.strictEqual(value, 'uk');
    });

    it('should submit form after accepting terms', async () => {
      if (!commander) {
        return;
      }

      // Check terms
      await commander.click({ selector: '[data-testid="checkbox-terms"]' });
      await commander.wait({ ms: 100 });

      // Submit form
      await commander.click({ selector: '[data-testid="btn-submit"]' });

      // Wait for result
      await commander.wait({ ms: 600 });

      // Check result
      const isVisible = await commander.isVisible({
        selector: '[data-testid="submit-result"]',
      });
      assert.strictEqual(isVisible, true);
    });

    it('should reset form', async () => {
      if (!commander) {
        return;
      }

      await commander.click({ selector: '[data-testid="btn-reset"]' });
      await commander.wait({ ms: 100 });

      const nameValue = await commander.inputValue({
        selector: '[data-testid="input-name"]',
      });
      assert.strictEqual(nameValue, '');
    });
  });

  describe('Interactive Elements', () => {
    it('should work with counter', async () => {
      if (!commander) {
        return;
      }

      // Increment multiple times
      await commander.click({ selector: '[data-testid="btn-increment"]' });
      await commander.click({ selector: '[data-testid="btn-increment"]' });
      await commander.click({ selector: '[data-testid="btn-increment"]' });
      await commander.wait({ ms: 50 });

      const value = await commander.textContent({
        selector: '[data-testid="counter-value"]',
      });
      assert.ok(parseInt(value) >= 3);
    });

    it('should toggle switch state', async () => {
      if (!commander) {
        return;
      }

      // Get initial state
      const initialStatus = await commander.textContent({
        selector: '[data-testid="toggle-status"]',
      });

      // Toggle
      await commander.click({ selector: '[data-testid="toggle-switch"]' });
      await commander.wait({ ms: 50 });

      // Verify changed
      const newStatus = await commander.textContent({
        selector: '[data-testid="toggle-status"]',
      });
      assert.notStrictEqual(initialStatus.trim(), newStatus.trim());

      // Toggle back
      await commander.click({ selector: '[data-testid="toggle-switch"]' });
      await commander.wait({ ms: 50 });

      // Verify back to original
      const finalStatus = await commander.textContent({
        selector: '[data-testid="toggle-status"]',
      });
      assert.strictEqual(initialStatus.trim(), finalStatus.trim());
    });

    it('should interact with custom dropdown', async () => {
      if (!commander) {
        return;
      }

      // Open
      await commander.click({ selector: '[data-testid="dropdown-trigger"]' });
      await commander.wait({ ms: 100 });

      // Select Option B
      await commander.click({
        selector: '[data-testid="dropdown-option-option-b"]',
      });
      await commander.wait({ ms: 100 });

      // Verify
      const selected = await commander.textContent({
        selector: '[data-testid="dropdown-selected"]',
      });
      assert.ok(selected.includes('Option B'));
    });

    it('should handle modal interactions', async () => {
      if (!commander) {
        return;
      }

      // Open modal
      await commander.click({ selector: '[data-testid="btn-open-modal"]' });
      await commander.wait({ ms: 150 });

      // Modal should be visible
      const modalVisible = await commander.isVisible({
        selector: '[data-testid="modal"]',
      });
      assert.strictEqual(modalVisible, true);

      // Type in modal input
      await commander.fill({
        selector: '[data-testid="modal-input"]',
        text: 'Puppeteer modal test',
      });

      // Cancel
      await commander.click({ selector: '[data-testid="modal-cancel"]' });
      await commander.wait({ ms: 100 });

      // Modal should be closed
      const modalClosed = await commander.isVisible({
        selector: '[data-testid="modal"]',
      });
      assert.strictEqual(modalClosed, false);
    });
  });

  describe('Element State & Content', () => {
    it('should check visibility of multiple elements', async () => {
      if (!commander) {
        return;
      }

      const sections = [
        'form-section',
        'interactive-section',
        'scroll-section',
        'navigation-section',
      ];

      for (const section of sections) {
        const visible = await commander.isVisible({
          selector: `[data-testid="${section}"]`,
        });
        assert.strictEqual(
          visible,
          true,
          `Section ${section} should be visible`
        );
      }
    });

    it('should count scroll items', async () => {
      if (!commander) {
        return;
      }

      const count = await commander.count({ selector: '.scroll-item' });
      assert.strictEqual(count, 20);
    });

    it('should get multiple attributes', async () => {
      if (!commander) {
        return;
      }

      const page1Href = await commander.getAttribute({
        selector: '[data-testid="link-page-1"]',
        attribute: 'href',
      });
      const page2Href = await commander.getAttribute({
        selector: '[data-testid="link-page-2"]',
        attribute: 'href',
      });

      assert.strictEqual(page1Href, '/page-1');
      assert.strictEqual(page2Href, '/page-2');
    });
  });

  describe('Scroll Operations', () => {
    it('should scroll to element in container', async () => {
      if (!commander) {
        return;
      }

      // Scroll to specific item
      await commander.scroll({ selector: '[data-testid="scroll-item-15"]' });
      await commander.wait({ ms: 500 });

      // Target should be visible
      const visible = await commander.isVisible({
        selector: '[data-testid="scroll-target-button"]',
      });
      assert.strictEqual(visible, true);
    });
  });

  describe('Evaluate', () => {
    it('should execute JavaScript in page context', async () => {
      if (!commander) {
        return;
      }

      const result = await commander.evaluate({
        fn: () => document.title,
      });
      assert.ok(result.includes('React Test App'));
    });

    it('should pass arguments to evaluated function', async () => {
      if (!commander) {
        return;
      }

      const result = await commander.evaluate({
        fn: (a, b) => a + b,
        args: [2, 3],
      });
      assert.strictEqual(result, 5);
    });
  });

  describe('Wait Operations', () => {
    it('should wait for specified time', async () => {
      if (!commander) {
        return;
      }

      const start = Date.now();
      await commander.wait({ ms: 100 });
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 90, `Expected at least 90ms, got ${elapsed}`);
    });
  });
});
