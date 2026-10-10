import { writeCapture } from './files.js';
import path from 'node:path';
import webp from 'webp-wasm';
import { decodePng, encodePng, resizeFrame } from './encoding.js';
import { UnsupportedCaptureError } from './errors.js';

/**
 * @typedef {Object} ScreenshotOptions
 * @property {string} [path]
 * @property {boolean} [fullPage]
 * @property {string} [selector]
 * @property {Object} [element]
 * @property {{x:number,y:number,width:number,height:number}} [clip]
 * @property {string} [format] png, jpeg or webp
 * @property {number} [quality]
 * @property {string} [scale] css or device
 * @property {boolean} [omitBackground]
 * @property {string} [animations] allow or disabled
 * @property {string} [caret] hide or initial
 * @property {boolean} [hideScrollbars]
 * @property {boolean} [hideCaret]
 * @property {boolean} [disableAnimations]
 * @property {boolean} [waitForFonts]
 */
export async function screenshot(options = {}) {
  const {
    page,
    engine = 'playwright',
    selector,
    element,
    clip,
    fullPage = false,
    scale = 'device',
    quality,
    path: output,
  } = options;
  if (
    !['playwright', 'puppeteer', 'selenium', 'chromiumoxide'].includes(
      engine
    ) ||
    typeof page?.screenshot !== 'function'
  ) {
    throw new UnsupportedCaptureError('screenshot', engine);
  }
  const { format, animations, caret } = validateScreenshot(options);
  const native = {
    type: format === 'webp' ? 'png' : format,
    fullPage,
    ...(clip ? { clip } : {}),
    ...(format === 'jpeg' && quality !== undefined ? { quality } : {}),
  };
  if (options.omitBackground) {
    if (engine === 'selenium') {
      throw new UnsupportedCaptureError('omitBackground', engine);
    }
    native.omitBackground = true;
  }
  const css = captureStyle(options, animations, caret);
  if (options.waitForFonts) {
    await page.evaluate(() => document.fonts.ready.then(() => true));
  }
  let styleId;
  if (engine === 'playwright') {
    Object.assign(native, {
      scale,
      animations,
      caret: 'initial',
      ...(css ? { style: css } : {}),
    });
  } else if (css) {
    styleId = await page.evaluate((css) => {
      const style = document.createElement('style');
      style.id = `browser-commander-capture-${Math.random().toString(36).slice(2)}`;
      style.textContent = css;
      document.documentElement.appendChild(style);
      return style.id;
    }, css);
  }
  let target = page;
  try {
    if (selector || element) {
      target =
        element ??
        (engine === 'playwright'
          ? page.locator(selector).first()
          : await page.$(selector));
      if (!target) {
        throw new Error(`No element matches ${selector}`);
      }
      if (typeof target.screenshot !== 'function') {
        throw new UnsupportedCaptureError('element screenshot', engine);
      }
      delete native.fullPage;
    }
    return await finishScreenshot(
      Buffer.from(await target.screenshot(native)),
      { page, engine, scale, format, quality, output }
    );
  } finally {
    if (styleId) {
      await page.evaluate(
        (id) => document.getElementById(id)?.remove(),
        styleId
      );
    }
  }
}

async function finishScreenshot(
  bytes,
  { page, engine, scale, format, quality, output }
) {
  if (scale === 'css' && engine !== 'playwright') {
    if (format === 'jpeg') {
      throw new UnsupportedCaptureError('JPEG CSS scale', engine);
    }
    const ratio = await page.evaluate(() => window.devicePixelRatio);
    if (ratio !== 1) {
      bytes = encodePng(resizeFrame(decodePng(bytes), 1 / ratio));
    }
  }
  if (format === 'webp') {
    bytes = await webp.encode(decodePng(bytes), { quality: quality ?? 75 });
  }
  return writeCapture(bytes, output);
}

function validateScreenshot(options) {
  const engine = options.engine ?? 'playwright';
  const {
    path: output,
    quality,
    scale = 'device',
    selector,
    element,
    clip,
    fullPage,
  } = options;
  const extension = output ? path.extname(output).slice(1).toLowerCase() : '';
  const format =
    options.format ??
    options.type ??
    (extension === 'jpg'
      ? 'jpeg'
      : ['png', 'jpeg', 'webp'].includes(extension)
        ? extension
        : 'png');
  if (!['png', 'jpeg', 'webp'].includes(format)) {
    throw new UnsupportedCaptureError(format, engine);
  }
  if (
    quality !== undefined &&
    (!Number.isInteger(quality) ||
      quality < 0 ||
      quality > 100 ||
      format === 'png')
  ) {
    throw new RangeError('quality must be an integer 0–100 for JPEG/WebP');
  }
  if (!['css', 'device'].includes(scale)) {
    throw new RangeError('scale must be css or device');
  }
  if ([selector || element, clip, fullPage].filter(Boolean).length > 1) {
    throw new RangeError(
      'selector/element, clip and fullPage are mutually exclusive'
    );
  }
  if (
    clip &&
    (!['x', 'y', 'width', 'height'].every((key) =>
      Number.isFinite(clip[key])
    ) ||
      clip.x < 0 ||
      clip.y < 0 ||
      clip.width <= 0 ||
      clip.height <= 0)
  ) {
    throw new RangeError(
      'clip must have nonnegative coordinates and positive dimensions'
    );
  }
  const animations =
    options.animations ?? (options.disableAnimations ? 'disabled' : 'allow');
  const caret = options.caret ?? (options.hideCaret ? 'hide' : 'initial');
  if (
    !['allow', 'disabled'].includes(animations) ||
    !['hide', 'initial'].includes(caret)
  ) {
    throw new RangeError('invalid animations/caret option');
  }
  return { format, animations, caret };
}

function captureStyle(options, animations, caret) {
  return [
    options.hideScrollbars
      ? '*::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}'
      : '',
    caret === 'hide' ? '*{caret-color:transparent!important}' : '',
    animations === 'disabled'
      ? '*,*::before,*::after{animation:none!important;transition:none!important}'
      : '',
  ].join('');
}
