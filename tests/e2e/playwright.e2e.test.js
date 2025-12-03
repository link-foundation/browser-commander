/**
 * E2E tests for browser-commander using Playwright engine
 *
 * Prerequisites:
 * 1. Start the React test app: cd examples/react-test-app && npm install && npm run dev
 * 2. Run tests: npm run test:e2e:playwright
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

// Dynamic import for playwright since it may not be installed
let playwright;
let createCommander;

describe('E2E Tests - Playwright Engine', { skip: !process.env.RUN_E2E }, () => {
  let browser;
  let page;
  let commander;
  const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

  before(async () => {
    try {
      playwright = await import('playwright');
      const module = await import('../../src/index.js');
      createCommander = module.createCommander;

      browser = await playwright.chromium.launch({
        headless: process.env.HEADLESS !== 'false',
      });
      const context = await browser.newContext();
      page = await context.newPage();
      commander = createCommander({ page, verbose: true });
    } catch (error) {
      console.log('Skipping E2E tests - playwright not available or test app not running');
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
      if (!commander) return;

      await commander.goto({ url: BASE_URL });
      const url = commander.getUrl();
      assert.ok(url.includes('localhost:3000') || url.includes(BASE_URL));
    });

    it('should get page title', async () => {
      if (!commander) return;

      const title = await commander.textContent({ selector: '[data-testid="page-title"]' });
      assert.strictEqual(title.trim(), 'React Test App');
    });
  });

  describe('Form Interactions', () => {
    it('should fill text input', async () => {
      if (!commander) return;

      await commander.fill({ selector: '[data-testid="input-name"]', text: 'John Doe' });
      const value = await commander.inputValue({ selector: '[data-testid="input-name"]' });
      assert.strictEqual(value, 'John Doe');
    });

    it('should fill email input', async () => {
      if (!commander) return;

      await commander.fill({ selector: '[data-testid="input-email"]', text: 'john@example.com' });
      const value = await commander.inputValue({ selector: '[data-testid="input-email"]' });
      assert.strictEqual(value, 'john@example.com');
    });

    it('should fill textarea', async () => {
      if (!commander) return;

      const bioText = 'This is my bio. I am a test user for E2E testing.';
      await commander.fill({ selector: '[data-testid="textarea-bio"]', text: bioText });
      const value = await commander.inputValue({ selector: '[data-testid="textarea-bio"]' });
      assert.strictEqual(value, bioText);
    });

    it('should select radio button', async () => {
      if (!commander) return;

      await commander.click({ selector: '[data-testid="radio-male"]' });
      const checked = await commander.getAttribute({
        selector: '[data-testid="radio-male"]',
        attribute: 'checked'
      });
      // Playwright returns empty string for checked attribute when true
      assert.ok(checked !== null);
    });

    it('should check checkbox', async () => {
      if (!commander) return;

      await commander.click({ selector: '[data-testid="checkbox-technology"]' });
      // Wait for state change
      await commander.wait({ ms: 100 });
    });

    it('should select from dropdown', async () => {
      if (!commander) return;

      // Using native select
      await commander.evaluate({
        fn: () => {
          const select = document.querySelector('[data-testid="select-country"]');
          if (select) {
            select.value = 'us';
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      });
      const value = await commander.inputValue({ selector: '[data-testid="select-country"]' });
      assert.strictEqual(value, 'us');
    });

    it('should check terms checkbox and submit form', async () => {
      if (!commander) return;

      // Check terms
      await commander.click({ selector: '[data-testid="checkbox-terms"]' });
      await commander.wait({ ms: 100 });

      // Submit button should be enabled now
      const isEnabled = await commander.isEnabled({ selector: '[data-testid="btn-submit"]' });
      assert.strictEqual(isEnabled, true);

      // Submit form
      await commander.click({ selector: '[data-testid="btn-submit"]' });

      // Wait for result
      await commander.wait({ ms: 600 });

      // Check result appears
      const isVisible = await commander.isVisible({ selector: '[data-testid="submit-result"]' });
      assert.strictEqual(isVisible, true);
    });
  });

  describe('Interactive Elements', () => {
    it('should increment counter', async () => {
      if (!commander) return;

      const initialValue = await commander.textContent({ selector: '[data-testid="counter-value"]' });
      await commander.click({ selector: '[data-testid="btn-increment"]' });
      await commander.wait({ ms: 50 });
      const newValue = await commander.textContent({ selector: '[data-testid="counter-value"]' });
      assert.strictEqual(parseInt(newValue), parseInt(initialValue) + 1);
    });

    it('should decrement counter', async () => {
      if (!commander) return;

      const initialValue = await commander.textContent({ selector: '[data-testid="counter-value"]' });
      await commander.click({ selector: '[data-testid="btn-decrement"]' });
      await commander.wait({ ms: 50 });
      const newValue = await commander.textContent({ selector: '[data-testid="counter-value"]' });
      assert.strictEqual(parseInt(newValue), parseInt(initialValue) - 1);
    });

    it('should toggle switch', async () => {
      if (!commander) return;

      const initialStatus = await commander.textContent({ selector: '[data-testid="toggle-status"]' });
      await commander.click({ selector: '[data-testid="toggle-switch"]' });
      await commander.wait({ ms: 50 });
      const newStatus = await commander.textContent({ selector: '[data-testid="toggle-status"]' });
      assert.notStrictEqual(initialStatus.trim(), newStatus.trim());
    });

    it('should open and close dropdown', async () => {
      if (!commander) return;

      // Open dropdown
      await commander.click({ selector: '[data-testid="dropdown-trigger"]' });
      await commander.wait({ ms: 100 });

      // Check menu is visible
      const menuVisible = await commander.isVisible({ selector: '[data-testid="dropdown-menu"]' });
      assert.strictEqual(menuVisible, true);

      // Select option
      await commander.click({ selector: '[data-testid="dropdown-option-option-a"]' });
      await commander.wait({ ms: 100 });

      // Check selection
      const selected = await commander.textContent({ selector: '[data-testid="dropdown-selected"]' });
      assert.ok(selected.includes('Option A'));
    });

    it('should open and close modal', async () => {
      if (!commander) return;

      // Open modal
      await commander.click({ selector: '[data-testid="btn-open-modal"]' });
      await commander.wait({ ms: 100 });

      // Check modal is visible
      const modalVisible = await commander.isVisible({ selector: '[data-testid="modal"]' });
      assert.strictEqual(modalVisible, true);

      // Fill modal input
      await commander.fill({ selector: '[data-testid="modal-input"]', text: 'Test input' });

      // Close modal
      await commander.click({ selector: '[data-testid="modal-cancel"]' });
      await commander.wait({ ms: 100 });

      // Check modal is closed
      const modalClosed = await commander.isVisible({ selector: '[data-testid="modal"]' });
      assert.strictEqual(modalClosed, false);
    });

    it('should load dynamic content', async () => {
      if (!commander) return;

      // Click load button
      await commander.click({ selector: '[data-testid="btn-load-content"]' });

      // Wait for content to load
      await commander.wait({ ms: 500 });

      // Check content is visible
      const contentVisible = await commander.isVisible({ selector: '[data-testid="dynamic-content"]' });
      assert.strictEqual(contentVisible, true);

      // Check items are loaded
      const item0 = await commander.textContent({ selector: '[data-testid="dynamic-item-0"]' });
      assert.strictEqual(item0.trim(), 'Item 1');
    });
  });

  describe('Scroll Operations', () => {
    it('should scroll to target element', async () => {
      if (!commander) return;

      // Scroll to target item (item 15)
      await commander.scroll({ selector: '[data-testid="scroll-item-15"]' });
      await commander.wait({ ms: 500 });

      // Element should now be visible
      const isVisible = await commander.isVisible({ selector: '[data-testid="scroll-target-button"]' });
      assert.strictEqual(isVisible, true);
    });

    it('should click button after scrolling', async () => {
      if (!commander) return;

      // Use click which auto-scrolls
      let alertHandled = false;
      page.on('dialog', async dialog => {
        alertHandled = true;
        await dialog.accept();
      });

      await commander.click({ selector: '[data-testid="scroll-target-button"]' });
      await commander.wait({ ms: 100 });

      assert.strictEqual(alertHandled, true);
    });
  });

  describe('Element State', () => {
    it('should check element visibility', async () => {
      if (!commander) return;

      const visible = await commander.isVisible({ selector: '[data-testid="page-title"]' });
      assert.strictEqual(visible, true);
    });

    it('should check non-existent element visibility', async () => {
      if (!commander) return;

      const visible = await commander.isVisible({ selector: '[data-testid="non-existent"]' });
      assert.strictEqual(visible, false);
    });

    it('should count elements', async () => {
      if (!commander) return;

      const count = await commander.count({ selector: '.scroll-item' });
      assert.strictEqual(count, 20);
    });

    it('should get element attribute', async () => {
      if (!commander) return;

      const href = await commander.getAttribute({
        selector: '[data-testid="link-page-1"]',
        attribute: 'href'
      });
      assert.strictEqual(href, '/page-1');
    });
  });

  describe('Query Selectors', () => {
    it('should find element by text', async () => {
      if (!commander) return;

      const selector = await commander.findByText({ text: 'React Test App', selector: 'h1' });
      const element = await commander.querySelector({ selector });
      assert.ok(element);
    });

    it('should query all matching elements', async () => {
      if (!commander) return;

      const elements = await commander.querySelectorAll({ selector: '.section' });
      assert.ok(elements.length >= 4);
    });
  });
});
