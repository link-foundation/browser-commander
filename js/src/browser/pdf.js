/**
 * PDF generation support
 *
 * Wraps Playwright/Puppeteer's page.pdf() method behind a unified interface.
 * Both engines expose identical options: format, printBackground, margin, etc.
 *
 * Note: PDF generation only works in Chromium headless mode.
 * Playwright Firefox and WebKit do not support page.pdf().
 */

import { createEngineAdapter } from '../core/engine-adapter.js';

/**
 * Generate a PDF of the current page
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Playwright or Puppeteer page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} options.pdfOptions - PDF generation options passed to the engine
 * @param {string} [options.pdfOptions.format] - Paper format (e.g. 'A4', 'Letter')
 * @param {boolean} [options.pdfOptions.printBackground] - Print background graphics
 * @param {Object} [options.pdfOptions.margin] - Page margins { top, right, bottom, left }
 * @param {string} [options.pdfOptions.path] - File path to save the PDF (optional)
 * @param {string} [options.pdfOptions.scale] - Scale of the webpage rendering (0.1–2)
 * @returns {Promise<Buffer>} - PDF as a Buffer
 */
export async function pdf(options = {}) {
  const { page, engine, pdfOptions = {} } = options;
  const adapter = createEngineAdapter(page, engine);
  return await adapter.pdf(pdfOptions);
}
