/**
 * Get current URL
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @returns {string} - Current URL
 */
export function getUrl(options = {}) {
  const { page } = options;
  return page.url();
}

/**
 * Unfocus address bar to prevent it from being selected
 * Fixes the annoying issue where address bar is focused after browser launch/navigation
 * Uses page.bringToFront() as recommended by Puppeteer/Playwright communities
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @returns {Promise<void>}
 */
export async function unfocusAddressBar(options = {}) {
  const { page } = options;

  if (!page) {
    throw new Error('page is required in options');
  }

  try {
    // Bring page to front - this removes focus from address bar
    await page.bringToFront();
  } catch {
    // Ignore errors - this is just a UX improvement
  }
}
