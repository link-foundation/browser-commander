import { isVisible } from '../elements/visibility.js';

/** Dismiss only overlays explicitly named by the caller. No page markers. */
export async function dismissOverlays({ page, engine, overlays = [] }) {
  if (!Array.isArray(overlays)) {
    throw new TypeError('overlays must be an array');
  }
  for (const item of overlays) {
    const options = typeof item === 'string' ? { selector: item } : item;
    if (!options?.selector) {
      throw new TypeError('overlay requires selector');
    }
    if (engine === 'playwright') {
      const target = page.locator(options.selector).first();
      if (await target.isVisible()) {
        await target.click({ timeout: options.timeout ?? 1000 });
      }
    } else {
      const target = await page.$(options.selector);
      if (
        target &&
        (await isVisible({ page, engine, selector: options.selector }))
      ) {
        await target.click();
      }
    }
  }
}
