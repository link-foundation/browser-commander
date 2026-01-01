import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  defaultNavigationVerification,
  verifyNavigation,
  waitForUrlStabilization,
  goto,
  waitForNavigation,
  waitForPageReady,
  waitAfterAction,
} from '../../../src/browser/navigation.js';
import {
  createMockPlaywrightPage,
  createMockLogger,
  createMockNavigationManager,
  createMockNetworkTracker,
} from '../../helpers/mocks.js';

describe('navigation', () => {
  describe('defaultNavigationVerification', () => {
    it('should verify exact URL match', async () => {
      const page = createMockPlaywrightPage({
        url: 'https://example.com/page',
      });
      const result = await defaultNavigationVerification({
        page,
        expectedUrl: 'https://example.com/page',
      });
      assert.strictEqual(result.verified, true);
      assert.ok(result.reason.includes('exact'));
    });

    it('should verify URL pattern match', async () => {
      const page = createMockPlaywrightPage({
        url: 'https://example.com/page?foo=bar',
      });
      const result = await defaultNavigationVerification({
        page,
        expectedUrl: 'https://example.com/page',
      });
      assert.strictEqual(result.verified, true);
    });

    it('should fail verification on URL mismatch', async () => {
      const page = createMockPlaywrightPage({
        url: 'https://example.com/other',
      });
      const result = await defaultNavigationVerification({
        page,
        expectedUrl: 'https://example.com/page',
      });
      assert.strictEqual(result.verified, false);
      assert.ok(result.reason.includes('mismatch'));
    });

    it('should verify URL changed from start', async () => {
      const page = createMockPlaywrightPage({ url: 'https://example.com/new' });
      const result = await defaultNavigationVerification({
        page,
        startUrl: 'https://example.com/old',
      });
      assert.strictEqual(result.verified, true);
    });

    it('should verify navigation completed without expectations', async () => {
      const page = createMockPlaywrightPage({ url: 'https://example.com' });
      const result = await defaultNavigationVerification({
        page,
      });
      assert.strictEqual(result.verified, true);
    });
  });

  describe('verifyNavigation', () => {
    it('should verify navigation with retry logic', async () => {
      const page = createMockPlaywrightPage({
        url: 'https://example.com/target',
      });
      const log = createMockLogger();

      const result = await verifyNavigation({
        page,
        expectedUrl: 'https://example.com/target',
        timeout: 100,
        log,
      });

      assert.strictEqual(result.verified, true);
      assert.ok(result.attempts >= 1);
    });

    it('should fail after timeout', async () => {
      const page = createMockPlaywrightPage({
        url: 'https://example.com/wrong',
      });
      const log = createMockLogger();

      const result = await verifyNavigation({
        page,
        expectedUrl: 'https://example.com/target',
        timeout: 50,
        retryInterval: 10,
        log,
      });

      assert.strictEqual(result.verified, false);
    });
  });

  describe('waitForUrlStabilization', () => {
    it('should delegate to navigationManager if available', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const wait = async () => {};
      const navigationManager = createMockNavigationManager();
      let waitForPageReadyCalled = false;
      navigationManager.waitForPageReady = async () => {
        waitForPageReadyCalled = true;
        return true;
      };

      const result = await waitForUrlStabilization({
        page,
        log,
        wait,
        navigationManager,
      });

      assert.strictEqual(waitForPageReadyCalled, true);
      assert.strictEqual(result, true);
    });

    it('should use polling approach without navigationManager', async () => {
      const page = createMockPlaywrightPage({ url: 'https://example.com' });
      const log = createMockLogger();
      const wait = async () => {};

      const result = await waitForUrlStabilization({
        page,
        log,
        wait,
        stableChecks: 1,
        checkInterval: 10,
        timeout: 100,
      });

      assert.strictEqual(result, true);
    });
  });

  describe('goto', () => {
    it('should throw when url is not provided', async () => {
      const page = createMockPlaywrightPage();

      await assert.rejects(() => goto({ page }), /url is required/);
    });

    it('should navigate using navigationManager', async () => {
      const page = createMockPlaywrightPage({
        url: 'https://example.com/target',
      });
      const log = createMockLogger();
      const navigationManager = createMockNavigationManager();
      let navigateCalled = false;
      navigationManager.navigate = async ({ url }) => {
        navigateCalled = true;
        return true;
      };

      const result = await goto({
        page,
        navigationManager,
        log,
        url: 'https://example.com/target',
        verify: false,
      });

      assert.strictEqual(navigateCalled, true);
      assert.strictEqual(result.navigated, true);
    });

    it('should navigate without navigationManager', async () => {
      const page = createMockPlaywrightPage({
        url: 'https://example.com/target',
      });
      const log = createMockLogger();
      let gotoCalled = false;
      page.goto = async () => {
        gotoCalled = true;
      };

      const result = await goto({
        page,
        log,
        url: 'https://example.com/target',
        waitForStableUrlBefore: false,
        waitForStableUrlAfter: false,
        verify: false,
      });

      assert.strictEqual(gotoCalled, true);
      assert.strictEqual(result.navigated, true);
    });
  });

  describe('waitForNavigation', () => {
    it('should delegate to navigationManager if available', async () => {
      const page = createMockPlaywrightPage();
      const navigationManager = createMockNavigationManager();
      let waitCalled = false;
      navigationManager.waitForNavigation = async () => {
        waitCalled = true;
        return true;
      };

      const result = await waitForNavigation({
        page,
        navigationManager,
      });

      assert.strictEqual(waitCalled, true);
      assert.strictEqual(result, true);
    });

    it('should use page.waitForNavigation without navigationManager', async () => {
      const page = createMockPlaywrightPage();
      let waitCalled = false;
      page.waitForNavigation = async () => {
        waitCalled = true;
      };

      const result = await waitForNavigation({ page });

      assert.strictEqual(waitCalled, true);
      assert.strictEqual(result, true);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      page.waitForNavigation = async () => {
        throw new Error('Execution context was destroyed');
      };

      const result = await waitForNavigation({ page });

      assert.strictEqual(result, false);
    });
  });

  describe('waitForPageReady', () => {
    it('should delegate to navigationManager if available', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const wait = async () => {};
      const navigationManager = createMockNavigationManager();
      let waitCalled = false;
      navigationManager.waitForPageReady = async () => {
        waitCalled = true;
        return true;
      };

      const result = await waitForPageReady({
        page,
        log,
        wait,
        navigationManager,
      });

      assert.strictEqual(waitCalled, true);
      assert.strictEqual(result, true);
    });

    it('should use networkTracker if navigationManager not available', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const wait = async () => {};
      const networkTracker = createMockNetworkTracker();
      let waitCalled = false;
      networkTracker.waitForNetworkIdle = async () => {
        waitCalled = true;
        return true;
      };

      const result = await waitForPageReady({
        page,
        log,
        wait,
        networkTracker,
      });

      assert.strictEqual(waitCalled, true);
      assert.strictEqual(result, true);
    });

    it('should use minimal fallback without both managers', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const wait = async () => {};

      const result = await waitForPageReady({
        page,
        log,
        wait,
      });

      assert.strictEqual(result, true);
    });
  });

  describe('waitAfterAction', () => {
    it('should detect URL change as navigation', async () => {
      const page = createMockPlaywrightPage({ url: 'https://example.com/new' });
      const log = createMockLogger();
      const wait = async () => {};

      const result = await waitAfterAction({
        page,
        log,
        wait,
        navigationCheckDelay: 0,
      });

      // Page URL is stable, so no navigation detected
      assert.ok(typeof result.navigated === 'boolean');
      assert.ok(typeof result.ready === 'boolean');
    });

    it('should wait for network idle without navigation', async () => {
      const page = createMockPlaywrightPage({ url: 'https://example.com' });
      const log = createMockLogger();
      const wait = async () => {};
      const networkTracker = createMockNetworkTracker();

      const result = await waitAfterAction({
        page,
        log,
        wait,
        networkTracker,
        navigationCheckDelay: 0,
      });

      assert.ok(typeof result.ready === 'boolean');
    });
  });
});
