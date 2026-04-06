import { describe, it } from 'node:test';
import assert from 'node:assert';
import { pdf } from '../../../src/browser/pdf.js';
import {
  createMockPlaywrightPage,
  createMockPuppeteerPage,
} from '../../helpers/mocks.js';

describe('browser/pdf', () => {
  describe('pdf() with Playwright engine', () => {
    it('should return a Buffer', async () => {
      const page = createMockPlaywrightPage();
      const result = await pdf({ page, engine: 'playwright' });
      assert.ok(result instanceof Buffer || result instanceof Uint8Array);
    });

    it('should pass pdf options to the underlying page', async () => {
      const capturedOptions = {};
      const page = createMockPlaywrightPage();
      page.pdf = async (opts = {}) => {
        Object.assign(capturedOptions, opts);
        return Buffer.from('%PDF-1.4');
      };

      await pdf({
        page,
        engine: 'playwright',
        pdfOptions: {
          format: 'A4',
          printBackground: true,
          margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
        },
      });

      assert.strictEqual(capturedOptions.format, 'A4');
      assert.strictEqual(capturedOptions.printBackground, true);
      assert.deepStrictEqual(capturedOptions.margin, {
        top: '1cm',
        right: '1cm',
        bottom: '1cm',
        left: '1cm',
      });
    });

    it('should work with empty options', async () => {
      const page = createMockPlaywrightPage();
      const result = await pdf({ page, engine: 'playwright', pdfOptions: {} });
      assert.ok(result);
    });
  });

  describe('pdf() with Puppeteer engine', () => {
    it('should return a Buffer', async () => {
      const page = createMockPuppeteerPage();
      const result = await pdf({ page, engine: 'puppeteer' });
      assert.ok(result instanceof Buffer || result instanceof Uint8Array);
    });

    it('should pass pdf options to the underlying page', async () => {
      const capturedOptions = {};
      const page = createMockPuppeteerPage();
      page.pdf = async (opts = {}) => {
        Object.assign(capturedOptions, opts);
        return Buffer.from('%PDF-1.4');
      };

      await pdf({
        page,
        engine: 'puppeteer',
        pdfOptions: {
          format: 'Letter',
          printBackground: false,
        },
      });

      assert.strictEqual(capturedOptions.format, 'Letter');
      assert.strictEqual(capturedOptions.printBackground, false);
    });
  });
});
