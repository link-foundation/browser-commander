import { createCdpSession } from '../browser/cdp-session.js';

export function validateStableViewport(options, animations, caret) {
  const changes = [
    options.selector,
    options.element,
    options.clip,
    options.fullPage,
    options.omitBackground,
    options.hideScrollbars,
    animations !== 'allow',
    caret !== 'initial',
  ];
  if (options.stableViewport && changes.some(Boolean)) {
    throw new RangeError(
      'stableViewport requires the unmodified viewport: no region, background or visual styling options'
    );
  }
}

/** Capture the existing view; never scroll, resize, activate, or capture beyond it. */
export async function captureStableViewport(page, engine, native) {
  // Native-view capture bypasses emulated pixel density. Keep the engine's viewport path.
  const viewport =
    engine === 'playwright' ? page.viewportSize?.() : page.viewport?.();
  if (viewport) {
    return { bytes: Buffer.from(await page.screenshot(native)), engine };
  }
  let session;
  if (
    (engine === 'playwright' && typeof page.context === 'function') ||
    (engine === 'puppeteer' &&
      (typeof page.createCDPSession === 'function' ||
        typeof page.target === 'function'))
  ) {
    try {
      session = await createCdpSession(page, { engine });
    } catch (error) {
      if (
        error.name !== 'UnsupportedOperation' &&
        !/only supported by Chromium|CDP.*not supported|CDP.*unsupported|CDP support is required|does not support CDP/i.test(
          error.message
        )
      ) {
        throw error;
      }
    }
  }
  if (session) {
    try {
      const { data } = await session.send('Page.captureScreenshot', {
        format: native.type,
        fromSurface: false,
        captureBeyondViewport: false,
        ...(native.quality === undefined ? {} : { quality: native.quality }),
      });
      return { bytes: Buffer.from(data, 'base64'), engine: 'cdp' };
    } catch (error) {
      // Some headless builds cannot capture a native view. Preserve every other error.
      if (!/Unable to capture screenshot/i.test(error.message)) {
        throw error;
      }
    } finally {
      await session.detach();
    }
  }
  return { bytes: Buffer.from(await page.screenshot(native)), engine };
}
