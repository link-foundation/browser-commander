import { createEngineAdapter } from '../core/engine-adapter.js';

/**
 * Press a key at the page level (e.g. 'Escape', 'Enter', 'Tab').
 *
 * Supported key names follow the Playwright/Puppeteer convention:
 * https://playwright.dev/docs/api/class-keyboard#keyboard-press
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string} options.key - Key to press (e.g. 'Escape', 'Enter', 'Tab', 'ArrowDown')
 * @param {Object} [options.adapter] - Engine adapter (optional, created if not provided)
 * @returns {Promise<void>}
 */
export async function pressKey(options = {}) {
  const { page, engine, key, adapter: providedAdapter } = options;

  if (!key) {
    throw new Error('pressKey: key is required in options');
  }

  const adapter = providedAdapter || createEngineAdapter(page, engine);
  await adapter.keyboardPress(key);
}

/**
 * Type text at the page level (dispatches key events for each character).
 * Unlike element-level fill/type, this sends keyboard events to whatever
 * element is currently focused on the page.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string} options.text - Text to type
 * @param {Object} [options.adapter] - Engine adapter (optional, created if not provided)
 * @returns {Promise<void>}
 */
export async function typeText(options = {}) {
  const { page, engine, text, adapter: providedAdapter } = options;

  if (!text) {
    throw new Error('typeText: text is required in options');
  }

  const adapter = providedAdapter || createEngineAdapter(page, engine);
  await adapter.keyboardType(text);
}

/**
 * Hold a key down at the page level.
 * Must be paired with keyUp() to release the key.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string} options.key - Key to hold down
 * @param {Object} [options.adapter] - Engine adapter (optional, created if not provided)
 * @returns {Promise<void>}
 */
export async function keyDown(options = {}) {
  const { page, engine, key, adapter: providedAdapter } = options;

  if (!key) {
    throw new Error('keyDown: key is required in options');
  }

  const adapter = providedAdapter || createEngineAdapter(page, engine);
  await adapter.keyboardDown(key);
}

/**
 * Release a held key at the page level.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {string} options.key - Key to release
 * @param {Object} [options.adapter] - Engine adapter (optional, created if not provided)
 * @returns {Promise<void>}
 */
export async function keyUp(options = {}) {
  const { page, engine, key, adapter: providedAdapter } = options;

  if (!key) {
    throw new Error('keyUp: key is required in options');
  }

  const adapter = providedAdapter || createEngineAdapter(page, engine);
  await adapter.keyboardUp(key);
}
