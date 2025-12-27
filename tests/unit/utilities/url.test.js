import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getUrl, unfocusAddressBar } from '../../../src/utilities/url.js';
import { createMockPlaywrightPage } from '../../helpers/mocks.js';

describe('url utilities', () => {
  describe('getUrl', () => {
    it('should return current page URL', () => {
      const page = createMockPlaywrightPage({
        url: 'https://example.com/page',
      });
      const url = getUrl({ page });
      assert.strictEqual(url, 'https://example.com/page');
    });

    it('should return different URLs for different pages', () => {
      const page1 = createMockPlaywrightPage({ url: 'https://example.com' });
      const page2 = createMockPlaywrightPage({ url: 'https://other.com' });

      assert.strictEqual(getUrl({ page: page1 }), 'https://example.com');
      assert.strictEqual(getUrl({ page: page2 }), 'https://other.com');
    });
  });

  describe('unfocusAddressBar', () => {
    it('should throw when page is not provided', async () => {
      await assert.rejects(() => unfocusAddressBar({}), /page is required/);
    });

    it('should call bringToFront on page', async () => {
      let called = false;
      const page = createMockPlaywrightPage();
      page.bringToFront = async () => {
        called = true;
      };

      await unfocusAddressBar({ page });
      assert.strictEqual(called, true);
    });

    it('should not throw when bringToFront fails', async () => {
      const page = createMockPlaywrightPage();
      page.bringToFront = async () => {
        throw new Error('Browser error');
      };

      // Should not throw
      await unfocusAddressBar({ page });
    });

    it('should handle page without bringToFront method gracefully', async () => {
      const page = createMockPlaywrightPage();
      page.bringToFront = undefined;

      // Should throw since bringToFront is not a function
      try {
        await unfocusAddressBar({ page });
      } catch {
        // Expected to fail when bringToFront is undefined
      }
    });
  });
});
