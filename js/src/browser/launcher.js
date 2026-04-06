import path from 'path';
import os from 'os';
import { CHROME_ARGS } from '../core/constants.js';
import { disableTranslateInPreferences } from '../core/preferences.js';
import { emulateMedia } from './media.js';

/**
 * Launch browser with default configuration
 * @param {Object} options - Configuration options
 * @param {string} options.engine - Browser automation engine: 'playwright' or 'puppeteer'
 * @param {string} options.userDataDir - Path to user data directory
 * @param {boolean} options.headless - Run in headless mode (default: false)
 * @param {number} options.slowMo - Slow down operations by ms (default: 150 for Playwright, 0 for Puppeteer)
 * @param {boolean} options.verbose - Enable verbose logging (default: false)
 * @param {string[]} options.args - Custom Chrome arguments to append to the default CHROME_ARGS
 * @param {string|null} [options.colorScheme] - Emulate color scheme: 'light', 'dark', 'no-preference', or null to reset
 * @returns {Promise<Object>} - Object with browser and page
 */
export async function launchBrowser(options = {}) {
  const {
    engine = 'playwright',
    userDataDir = path.join(os.homedir(), '.hh-apply', `${engine}-data`),
    headless = false,
    slowMo = engine === 'playwright' ? 150 : 0,
    verbose = false,
    args = [],
    colorScheme,
  } = options;

  // Combine default CHROME_ARGS with custom args
  const chromeArgs = [...CHROME_ARGS, ...args];

  if (!['playwright', 'puppeteer'].includes(engine)) {
    throw new Error(
      `Invalid engine: ${engine}. Expected 'playwright' or 'puppeteer'`
    );
  }

  // Set environment variables to suppress warnings
  process.env.GOOGLE_API_KEY = 'no';
  process.env.GOOGLE_DEFAULT_CLIENT_ID = 'no';
  process.env.GOOGLE_DEFAULT_CLIENT_SECRET = 'no';

  // Disable translate in Preferences
  await disableTranslateInPreferences({ userDataDir });

  if (verbose) {
    console.log(`🚀 Launching browser with ${engine} engine...`);
  }

  let browser;
  let page;

  if (engine === 'playwright') {
    const { chromium } = await import('playwright');
    const contextOptions = {
      headless,
      slowMo,
      chromiumSandbox: true,
      viewport: null,
      args: chromeArgs,
      ignoreDefaultArgs: ['--enable-automation'],
    };
    // Playwright supports colorScheme as a context-level launch option
    if (colorScheme !== undefined) {
      contextOptions.colorScheme = colorScheme;
    }
    browser = await chromium.launchPersistentContext(
      userDataDir,
      contextOptions
    );
    page = browser.pages()[0];
  } else {
    const puppeteer = await import('puppeteer');
    browser = await puppeteer.default.launch({
      headless,
      defaultViewport: null,
      args: ['--start-maximized', ...chromeArgs],
      userDataDir,
    });
    const pages = await browser.pages();
    page = pages[0];
  }

  if (verbose) {
    console.log(`✅ Browser launched with ${engine} engine`);
  }

  // Apply color scheme emulation if requested (Puppeteer needs page-level emulation)
  if (colorScheme !== undefined && engine === 'puppeteer') {
    try {
      await emulateMedia({ page, engine, colorScheme });
      if (verbose) {
        console.log(`✅ Color scheme set to "${colorScheme}"`);
      }
    } catch (error) {
      if (verbose) {
        console.log(`⚠️  Could not set color scheme: ${error.message}`);
      }
    }
  }

  // Unfocus address bar automatically after browser launch
  // Using page.bringToFront() - confirmed working solution
  try {
    // Wait for the browser to fully initialize
    await new Promise((r) => setTimeout(r, 500));

    // Bring page to front - this removes focus from address bar
    await page.bringToFront();

    if (verbose) {
      console.log('✅ Address bar unfocused automatically');
    }
  } catch (error) {
    // Ignore errors - this is just a UX improvement
    if (verbose) {
      console.log('⚠️  Could not unfocus address bar:', error.message);
    }
  }

  return { browser, page };
}
