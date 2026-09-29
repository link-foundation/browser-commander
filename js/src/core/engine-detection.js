import { isVerboseEnabled } from './logger.js';

/**
 * Detect which browser automation engine is being used
 * @param {Object} pageOrContext - Page or context object from Playwright or
 *   Puppeteer, a selenium-webdriver WebDriver, or a WebDriverPage over one
 * @returns {string} - 'playwright', 'puppeteer' or 'selenium'
 */
export function detectEngine(pageOrContext) {
  // Selenium first: the WebDriverPage facade has $eval/$$eval like Puppeteer,
  // and a bare WebDriver has none of the page methods the checks below use.
  if (
    pageOrContext.isWebDriverPage === true ||
    (typeof pageOrContext.findElements === 'function' &&
      typeof pageOrContext.executeScript === 'function' &&
      typeof pageOrContext.getCurrentUrl === 'function')
  ) {
    if (isVerboseEnabled()) {
      console.log('🔍 [ENGINE DETECTION] Detected: selenium');
    }
    return 'selenium';
  }

  const hasEval = !!pageOrContext.$eval;
  const hasEvalAll = !!pageOrContext.$$eval;
  const locatorType = typeof pageOrContext.locator;
  const contextType = typeof pageOrContext.context;
  const hasContext = contextType === 'function' || contextType === 'object';

  // Debug logging
  if (isVerboseEnabled()) {
    console.log('🔍 [ENGINE DETECTION]', {
      hasEval,
      hasEvalAll,
      locatorType,
      contextType,
      hasContext,
    });
  }

  // Check for Playwright-specific methods first
  // Playwright has locator as a function and context() method
  // Both engines have $eval and $$eval, so we check for unique Playwright features first
  if (locatorType === 'function' && hasContext) {
    if (isVerboseEnabled()) {
      console.log('🔍 [ENGINE DETECTION] Detected: playwright');
    }
    return 'playwright';
  }
  // Check for Puppeteer-specific methods
  // Puppeteer has $eval, $$eval but no context() method
  if (hasEval && hasEvalAll && !hasContext) {
    if (isVerboseEnabled()) {
      console.log('🔍 [ENGINE DETECTION] Detected: puppeteer');
    }
    return 'puppeteer';
  }
  if (isVerboseEnabled()) {
    console.log('🔍 [ENGINE DETECTION] Could not detect engine!');
  }
  throw new Error(
    'Unknown browser automation engine. Expected a Playwright or Puppeteer page, or a selenium-webdriver WebDriver.'
  );
}
