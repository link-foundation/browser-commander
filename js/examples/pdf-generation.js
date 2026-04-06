/**
 * Example: PDF generation via browser-commander
 *
 * This example shows how to use the unified page.pdf() method
 * instead of the old workaround: `const rawPage = page._page || page`.
 *
 * Supports both Playwright and Puppeteer engines.
 *
 * Usage (Playwright):
 *   node examples/pdf-generation.js playwright
 *
 * Usage (Puppeteer):
 *   node examples/pdf-generation.js puppeteer
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeBrowserCommander } from '../src/factory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engine = process.argv[2] || 'playwright';

async function generatePdf() {
  let browser;
  let page;

  if (engine === 'playwright') {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();
  } else if (engine === 'puppeteer') {
    const puppeteer = await import('puppeteer');
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
  } else {
    console.error(`Unknown engine: ${engine}. Use 'playwright' or 'puppeteer'.`);
    process.exit(1);
  }

  try {
    const commander = makeBrowserCommander({ page, verbose: false });

    // Navigate to a page
    await page.goto('https://example.com');

    // Generate PDF using the unified API (no workarounds needed!)
    const pdfBuffer = await commander.pdf({
      pdfOptions: {
        format: 'A4',
        printBackground: true,
        margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
      },
    });

    const outputPath = path.join(__dirname, 'output.pdf');
    fs.writeFileSync(outputPath, pdfBuffer);

    console.log(`PDF generated successfully: ${outputPath} (${pdfBuffer.length} bytes)`);

    await commander.destroy();
  } finally {
    await browser.close();
  }
}

generatePdf().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
