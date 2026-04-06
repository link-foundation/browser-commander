import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { emulateMedia } from '../../../src/browser/media.js';

describe('emulateMedia', () => {
  describe('input validation', () => {
    it('should throw if page is not provided', async () => {
      await assert.rejects(
        () => emulateMedia({ engine: 'playwright', colorScheme: 'dark' }),
        /page is required/
      );
    });

    it('should throw if engine is not provided', async () => {
      const mockPage = {};
      await assert.rejects(
        () => emulateMedia({ page: mockPage, colorScheme: 'dark' }),
        /engine is required/
      );
    });

    it('should throw for invalid colorScheme', async () => {
      const mockPage = {};
      await assert.rejects(
        () =>
          emulateMedia({
            page: mockPage,
            engine: 'playwright',
            colorScheme: 'invalid',
          }),
        /Invalid colorScheme/
      );
    });

    it('should throw for unsupported engine', async () => {
      const mockPage = {};
      await assert.rejects(
        () =>
          emulateMedia({
            page: mockPage,
            engine: 'selenium',
            colorScheme: 'dark',
          }),
        /Unsupported engine/
      );
    });
  });

  describe('Playwright engine', () => {
    let capturedMediaOptions;
    let mockPage;

    beforeEach(() => {
      capturedMediaOptions = null;
      mockPage = {
        emulateMedia: async (options) => {
          capturedMediaOptions = options;
        },
      };
    });

    it('should call page.emulateMedia with colorScheme: dark', async () => {
      await emulateMedia({
        page: mockPage,
        engine: 'playwright',
        colorScheme: 'dark',
      });
      assert.deepStrictEqual(capturedMediaOptions, { colorScheme: 'dark' });
    });

    it('should call page.emulateMedia with colorScheme: light', async () => {
      await emulateMedia({
        page: mockPage,
        engine: 'playwright',
        colorScheme: 'light',
      });
      assert.deepStrictEqual(capturedMediaOptions, { colorScheme: 'light' });
    });

    it('should call page.emulateMedia with colorScheme: no-preference', async () => {
      await emulateMedia({
        page: mockPage,
        engine: 'playwright',
        colorScheme: 'no-preference',
      });
      assert.deepStrictEqual(capturedMediaOptions, {
        colorScheme: 'no-preference',
      });
    });

    it('should call page.emulateMedia with colorScheme: null to reset', async () => {
      await emulateMedia({
        page: mockPage,
        engine: 'playwright',
        colorScheme: null,
      });
      assert.deepStrictEqual(capturedMediaOptions, { colorScheme: null });
    });

    it('should call page.emulateMedia with empty options when no colorScheme given', async () => {
      await emulateMedia({
        page: mockPage,
        engine: 'playwright',
      });
      assert.deepStrictEqual(capturedMediaOptions, {});
    });
  });

  describe('Puppeteer engine', () => {
    let capturedFeatures;
    let mockPage;

    beforeEach(() => {
      capturedFeatures = null;
      mockPage = {
        emulateMediaFeatures: async (features) => {
          capturedFeatures = features;
        },
      };
    });

    it('should call page.emulateMediaFeatures with dark colorScheme', async () => {
      await emulateMedia({
        page: mockPage,
        engine: 'puppeteer',
        colorScheme: 'dark',
      });
      assert.deepStrictEqual(capturedFeatures, [
        { name: 'prefers-color-scheme', value: 'dark' },
      ]);
    });

    it('should call page.emulateMediaFeatures with light colorScheme', async () => {
      await emulateMedia({
        page: mockPage,
        engine: 'puppeteer',
        colorScheme: 'light',
      });
      assert.deepStrictEqual(capturedFeatures, [
        { name: 'prefers-color-scheme', value: 'light' },
      ]);
    });

    it('should call page.emulateMediaFeatures with no-preference colorScheme', async () => {
      await emulateMedia({
        page: mockPage,
        engine: 'puppeteer',
        colorScheme: 'no-preference',
      });
      assert.deepStrictEqual(capturedFeatures, [
        { name: 'prefers-color-scheme', value: 'no-preference' },
      ]);
    });

    it('should reset by passing empty string when colorScheme is null', async () => {
      await emulateMedia({
        page: mockPage,
        engine: 'puppeteer',
        colorScheme: null,
      });
      assert.deepStrictEqual(capturedFeatures, [
        { name: 'prefers-color-scheme', value: '' },
      ]);
    });

    it('should reset by passing empty string when colorScheme is undefined', async () => {
      await emulateMedia({
        page: mockPage,
        engine: 'puppeteer',
      });
      assert.deepStrictEqual(capturedFeatures, [
        { name: 'prefers-color-scheme', value: '' },
      ]);
    });
  });
});
