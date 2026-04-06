/**
 * Browser Commander - Media Emulation
 * Provides unified color scheme emulation across Playwright and Puppeteer.
 */

const VALID_COLOR_SCHEMES = ['light', 'dark', 'no-preference'];

/**
 * Emulate media features (e.g. prefers-color-scheme) for the page.
 *
 * @param {Object} options
 * @param {Object} options.page - Playwright or Puppeteer page object
 * @param {string} options.engine - Engine type: 'playwright' or 'puppeteer'
 * @param {string|null} [options.colorScheme] - Color scheme: 'light', 'dark', 'no-preference', or null to reset
 * @returns {Promise<void>}
 */
export async function emulateMedia({ page, engine, colorScheme } = {}) {
  if (!page) {
    throw new Error('page is required in emulateMedia');
  }
  if (!engine) {
    throw new Error('engine is required in emulateMedia');
  }

  if (colorScheme !== null && colorScheme !== undefined) {
    if (!VALID_COLOR_SCHEMES.includes(colorScheme)) {
      throw new Error(
        `Invalid colorScheme: "${colorScheme}". Expected one of: ${VALID_COLOR_SCHEMES.join(', ')}, or null`
      );
    }
  }

  if (engine === 'playwright') {
    // Playwright supports emulateMedia natively
    const mediaOptions = {};
    if (colorScheme !== undefined) {
      mediaOptions.colorScheme = colorScheme;
    }
    await page.emulateMedia(mediaOptions);
  } else if (engine === 'puppeteer') {
    // Puppeteer supports emulateMediaFeatures since v5.4.0
    if (colorScheme === null || colorScheme === undefined) {
      // Reset to default
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: '' },
      ]);
    } else {
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: colorScheme },
      ]);
    }
  } else {
    throw new Error(
      `Unsupported engine: ${engine}. Expected 'playwright' or 'puppeteer'`
    );
  }
}
