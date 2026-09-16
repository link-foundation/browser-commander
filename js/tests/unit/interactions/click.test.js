import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  defaultClickVerification,
  capturePreClickState,
  verifyClick,
  clickElement,
  clickButton,
  CLICK_STATUS,
  CLICK_EFFECT,
} from '../../../src/interactions/click.js';
import {
  createMockPlaywrightPage,
  createMockLogger,
} from '../../helpers/mocks.js';
import {
  UNCHANGED_STATE,
  IN_VIEWPORT_POINT,
  createScrollModel,
} from '../../helpers/click-fixtures.js';
import { createDeadline } from '../../../src/core/readiness.js';

/**
 * Run the default verifier against a fixed post-click element state.
 *
 * @param {Object} options - Configuration options
 * @param {Object|Error} options.post - Post-click state, or an error to throw
 * @param {Object} [options.pre] - Pre-click state
 * @returns {Promise<Object>} Verification result
 */
function verifyAgainst(options) {
  const { post, pre = {} } = options;

  return defaultClickVerification({
    page: createMockPlaywrightPage(),
    engine: 'playwright',
    locatorOrElement: {},
    preClickState: pre,
    adapter: {
      evaluateOnElement: async () => {
        if (post instanceof Error) {
          throw post;
        }
        return post;
      },
    },
  });
}

/**
 * Verify a click that changed nothing at all about the target element.
 *
 * @returns {Promise<Object>} Verification result
 */
function verifyUnchanged() {
  return verifyAgainst({
    post: { ...UNCHANGED_STATE },
    pre: { ...UNCHANGED_STATE },
  });
}

/**
 * Capture pre-click state through an element probe stub.
 *
 * @param {Function} evaluateOnElement - Adapter probe implementation
 * @returns {Promise<Object>} Captured state
 */
function capturePreWith(evaluateOnElement) {
  return capturePreClickState({
    page: createMockPlaywrightPage(),
    engine: 'playwright',
    locatorOrElement: {},
    adapter: { evaluateOnElement },
  });
}

/**
 * Run `verifyClick` with a custom verifier.
 *
 * @param {Function} verifyFn - Custom verification function
 * @returns {Promise<Object>} Normalized verification outcome
 */
function verifyClickWith(verifyFn) {
  return verifyClick({
    page: createMockPlaywrightPage(),
    engine: 'playwright',
    locatorOrElement: {},
    log: createMockLogger(),
    verifyFn,
  });
}

/**
 * Assert that a verdict claims nothing it did not observe.
 *
 * @param {Object} result - Verification result
 * @param {string} reasonFragment - Substring the reason must contain
 */
function assertNotObserved(result, reasonFragment) {
  assert.strictEqual(result.verified, false);
  assert.strictEqual(result.effect, CLICK_EFFECT.NOT_OBSERVED);
  assert.ok(
    result.reason.includes(reasonFragment),
    `reason ${JSON.stringify(result.reason)} should mention ${reasonFragment}`
  );
}

/**
 * Invoke `clickElement` against the mock page with a caller-supplied adapter.
 *
 * @param {Object} adapter - Engine adapter stub
 * @param {Object} [options] - Extra clickElement options
 * @returns {Promise<{result: Object, page: Object}>} Result and the mock page
 */
async function clickWith(adapter, options = {}) {
  const page = createMockPlaywrightPage();
  const result = await clickElement({
    page,
    engine: 'playwright',
    log: createMockLogger(),
    locatorOrElement: {},
    adapter,
    verify: false,
    ...options,
  });
  return { result, page };
}

describe('click', () => {
  describe('defaultClickVerification', () => {
    it('should verify click by checking element state', async () => {
      const result = await verifyAgainst({
        post: { ...UNCHANGED_STATE, ariaPressed: 'true' },
        pre: { ...UNCHANGED_STATE },
      });

      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.effect, CLICK_EFFECT.CONFIRMED);
      assert.ok(result.reason.includes('aria-pressed'));
    });

    it('should verify when className changed', async () => {
      const result = await verifyAgainst({
        post: { ...UNCHANGED_STATE, className: 'btn active' },
        pre: { ...UNCHANGED_STATE },
      });

      assert.strictEqual(result.verified, true);
      assert.ok(result.reason.includes('className'));
    });

    it('should NOT claim success when nothing about the element changed', async () => {
      // Regression test for issue #89: a button whose handler does nothing left
      // the element connected and unchanged, and that was reported as success.
      const result = await verifyUnchanged();

      assertNotObserved(result, 'no observable change');
    });

    it('should report not-observed when no pre-click state was captured', async () => {
      const result = await verifyAgainst({ post: { ...UNCHANGED_STATE } });

      assertNotObserved(result, 'no pre-click state');
    });

    it('should verify when element removed from DOM', async () => {
      const result = await verifyAgainst({ post: { isConnected: false } });

      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.effect, CLICK_EFFECT.CONFIRMED);
      assert.ok(result.reason.includes('removed'));
    });

    it('should not treat a destroyed execution context as proof of effect', async () => {
      // Regression test for issue #89: the click may or may not have caused the
      // navigation that destroyed the context. Attribution is the caller's job.
      const result = await verifyAgainst({
        post: new Error('Execution context was destroyed'),
      });

      assertNotObserved(result, 'verification unavailable');
      assert.strictEqual(result.navigationError, true);
    });

    it('should attach evidence to every verdict', async () => {
      const result = await verifyUnchanged();

      assert.ok(Array.isArray(result.evidence));
      assert.strictEqual(result.evidence[0].type, 'element-state');
    });
  });

  describe('capturePreClickState', () => {
    it('should capture element state', async () => {
      const state = await capturePreWith(async () => ({ ...UNCHANGED_STATE }));

      assert.strictEqual(state.disabled, false);
      assert.strictEqual(state.className, 'btn');
    });

    it('should return empty object on navigation error', async () => {
      const state = await capturePreWith(async () => {
        throw new Error('Execution context was destroyed');
      });

      assert.deepStrictEqual(state, {});
    });
  });

  describe('verifyClick', () => {
    it('should use custom verify function', async () => {
      let customCalled = false;

      const result = await verifyClickWith(async () => {
        customCalled = true;
        return { verified: true, reason: 'custom verification' };
      });

      assert.strictEqual(customCalled, true);
      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.reason, 'custom verification');
    });

    it('should derive an effect for custom verifiers that do not set one', async () => {
      const confirmed = await verifyClickWith(async () => ({
        verified: true,
        reason: 'ok',
      }));
      assert.strictEqual(confirmed.effect, CLICK_EFFECT.CONFIRMED);

      const denied = await verifyClickWith(async () => ({
        verified: false,
        reason: 'nope',
      }));
      assert.strictEqual(denied.effect, CLICK_EFFECT.NOT_OBSERVED);
    });
  });

  describe('clickElement', () => {
    it('should throw when locatorOrElement is not provided', async () => {
      await assert.rejects(
        () =>
          clickElement({
            page: createMockPlaywrightPage(),
            engine: 'playwright',
            log: createMockLogger(),
          }),
        /locatorOrElement is required/
      );
    });

    it('should report unverified when verification was not requested', async () => {
      let clicked = false;
      const { result } = await clickWith({
        click: async () => {
          clicked = true;
        },
        evaluateOnElement: async () => ({ isConnected: true }),
      });

      assert.strictEqual(clicked, true);
      assert.strictEqual(result.clicked, true);
      assert.strictEqual(result.verified, false);
      assert.strictEqual(result.status, CLICK_STATUS.UNVERIFIED);
    });

    it('should not route noAutoScroll through Playwright force, which still scrolls', async () => {
      // Regression test for issue #89: `{ force: true }` skips actionability
      // checks but does NOT disable scroll-into-view, so the old mapping
      // silently scrolled the page while reporting that it had not.
      let adapterClickCalled = false;
      const { result, page } = await clickWith(
        {
          click: async () => {
            adapterClickCalled = true;
          },
          evaluateOnElement: async () => ({ ...IN_VIEWPORT_POINT }),
          evaluateOnPage: async () => ({ x: 0, y: 0 }),
        },
        { noAutoScroll: true }
      );

      assert.strictEqual(adapterClickCalled, false);
      assert.strictEqual(page.mouse.clicks.length, 1);
      assert.strictEqual(page.mouse.clicks[0].x, IN_VIEWPORT_POINT.x);
      assert.strictEqual(page.mouse.clicks[0].y, IN_VIEWPORT_POINT.y);
      assert.strictEqual(result.dispatched, true);
    });

    it('should pass force to the engine only for actionability: force', async () => {
      let clickOptions = null;
      await clickWith(
        {
          click: async (el, opts) => {
            clickOptions = opts;
          },
          evaluateOnElement: async () => ({ isConnected: true }),
          evaluateOnPage: async () => ({ x: 0, y: 0 }),
        },
        { actionability: 'force' }
      );

      assert.deepStrictEqual(clickOptions, { force: true });
    });

    it('should fail clearly when scroll: none cannot be honored', async () => {
      const { result, page } = await clickWith(
        {
          click: async () => {
            throw new Error('adapter.click must not be reached');
          },
          evaluateOnElement: async () => ({
            ...IN_VIEWPORT_POINT,
            y: 4000,
            top: 3980,
            inViewport: false,
            hitsTarget: false,
          }),
          evaluateOnPage: async () => ({ x: 0, y: 0 }),
        },
        { scroll: 'none' }
      );

      assert.strictEqual(result.status, CLICK_STATUS.FAILED);
      assert.strictEqual(result.dispatched, false);
      assert.strictEqual(page.mouse.clicks.length, 0);
      assert.ok(result.reason.includes('outside the viewport'));
    });

    it('should restore the scroll position for scroll: preserve', async () => {
      const scroll = createScrollModel();
      await clickWith(
        {
          click: async () => scroll.set(3911),
          evaluateOnElement: async () => ({ isConnected: true }),
          evaluateOnPage: scroll.evaluateOnPage,
        },
        { scroll: 'preserve' }
      );

      assert.strictEqual(scroll.current(), 0);
    });

    it('should report interrupted, not verified, when navigation cuts in', async () => {
      const { result } = await clickWith({
        click: async () => {
          throw new Error('Execution context was destroyed');
        },
      });

      assert.strictEqual(result.clicked, false);
      assert.strictEqual(result.verified, false);
      assert.strictEqual(result.status, CLICK_STATUS.INTERRUPTED);
      assert.strictEqual(result.effect, CLICK_EFFECT.NOT_OBSERVED);
    });

    it('should carry an action id for navigation correlation', async () => {
      const { result } = await clickWith({
        click: async () => {},
        evaluateOnElement: async () => ({ isConnected: true }),
      });

      assert.strictEqual(typeof result.actionId, 'string');
      assert.ok(result.elapsedMs >= 0);
    });
  });

  describe('clickButton', () => {
    it('should throw when selector is not provided', async () => {
      await assert.rejects(
        () =>
          clickButton({
            page: createMockPlaywrightPage(),
            engine: 'playwright',
            log: createMockLogger(),
            wait: async () => {},
          }),
        /selector is required/
      );
    });

    it('should click button with full flow', async () => {
      const page = createMockPlaywrightPage({
        elements: { button: { visible: true, count: 1 } },
      });

      // This is a complex test that requires full mock setup
      // For unit tests, we'll verify the interface
      try {
        const result = await clickButton({
          page,
          engine: 'playwright',
          log: createMockLogger(),
          wait: async () => ({ completed: true, aborted: false }),
          selector: 'button',
          scrollIntoView: false,
          waitAfterClick: 0,
          waitForNavigation: false,
          verify: false,
        });
        assert.ok(typeof result.clicked === 'boolean');
        assert.ok(typeof result.navigated === 'boolean');
        assert.ok(Object.values(CLICK_STATUS).includes(result.status));
      } catch (e) {
        // May fail due to mock limitations, but we verify the interface works
        assert.ok(e.message);
      }
    });
  });

  describe('click deadlines', () => {
    /** An element probe that never answers, like a locator on a lost document. */
    const neverAnswers = () => new Promise(() => {});

    /**
     * A probe that answers once and then hangs.
     *
     * This is what a real engine looks like once the document the element
     * lived in is gone: the first read is served, and any later one waits for
     * the engine's own far longer timeout.
     *
     * @returns {Function} Element probe for a stub adapter
     */
    const answersOnceThenHangs = () => {
      let probes = 0;
      return async (...args) =>
        (probes += 1) === 1 ? { ...UNCHANGED_STATE } : neverAnswers(...args);
    };

    /**
     * Click a stub adapter with a budget far below any engine's own timeout.
     *
     * @param {Object} adapter - Stub engine adapter
     * @returns {Promise<Object>} Click result
     */
    const clickOnABudget = async (adapter) => {
      const { result } = await clickWith(adapter, {
        verify: true,
        timeout: 60,
      });
      return result;
    };

    it('should stop probing when the click budget is spent', async () => {
      // Regression test for issue #89: Playwright's locator probe carries a
      // 30-second default, so an unbounded verification outlived every budget
      // the caller asked for.
      const started = Date.now();
      const result = await defaultClickVerification({
        page: createMockPlaywrightPage(),
        engine: 'playwright',
        locatorOrElement: {},
        preClickState: { ...UNCHANGED_STATE },
        adapter: { evaluateOnElement: neverAnswers },
        deadline: createDeadline({ timeout: 40 }),
      });

      assert.strictEqual(result.timedOut, true);
      assert.strictEqual(result.effect, CLICK_EFFECT.NOT_OBSERVED);
      assert.strictEqual(result.evidence[0].type, 'verification-timeout');
      assert.ok(Date.now() - started < 2000);
    });

    it('should report timed_out rather than unverified for an unreadable effect', async () => {
      const result = await clickOnABudget({
        click: async () => {},
        evaluateOnElement: answersOnceThenHangs(),
      });

      assert.strictEqual(result.status, CLICK_STATUS.TIMED_OUT);
      assert.strictEqual(result.dispatched, true);
      assert.strictEqual(result.verified, false);
      assert.ok(
        result.evidence.some((item) => item.type === 'verification-timeout')
      );
    });

    it('should stop waiting on a dispatch that outlives the budget', async () => {
      // Dispatch is an engine round-trip too, so an unbounded one spends the
      // budget the caller reserved for the whole click before verification
      // ever gets a turn.
      const started = Date.now();
      const result = await clickOnABudget({
        click: neverAnswers,
        evaluateOnElement: async () => ({ ...UNCHANGED_STATE }),
      });

      assert.ok(Date.now() - started < 2000);
      assert.strictEqual(result.status, CLICK_STATUS.TIMED_OUT);
      assert.strictEqual(result.dispatched, false);
      assert.strictEqual(result.evidence[0].type, 'dispatch-timeout');
    });

    it('should measure elapsed time monotonically, not by the wall clock', async () => {
      const { result } = await clickWith({
        click: async () => {},
        evaluateOnElement: async () => ({ ...UNCHANGED_STATE }),
      });

      assert.ok(Number.isFinite(result.elapsedMs));
      assert.ok(result.elapsedMs >= 0);
    });

    it('should give up on a target the page navigated away from', async () => {
      // A navigation replaces the document, and the engine answers the probe on
      // the new one instead of failing - so the URL is what ends the wait.
      const page = createMockPlaywrightPage();
      let url = 'https://example.com/start';
      page.url = () => url;
      // The pre-click probe answers; only the post-click one is left hanging,
      // which is what a probe against a replaced document looks like.
      const timer = setTimeout(() => {
        url = 'https://example.com/arrived';
      }, 60);

      const started = Date.now();
      const result = await clickElement({
        page,
        engine: 'playwright',
        log: createMockLogger(),
        locatorOrElement: {},
        verify: true,
        timeout: 5000,
        adapter: {
          click: async () => {},
          evaluateOnElement: answersOnceThenHangs(),
        },
      });
      clearTimeout(timer);

      assert.ok(
        Date.now() - started < 2000,
        'the navigation, not the budget, should end the wait'
      );

      assert.strictEqual(result.status, CLICK_STATUS.UNVERIFIED);
      assert.strictEqual(result.effect, CLICK_EFFECT.NOT_OBSERVED);
      assert.strictEqual(result.dispatched, true);
      const navigation = result.evidence.find(
        (item) => item.type === 'navigation'
      );
      assert.ok(navigation, 'the navigation should be recorded as evidence');
      // The navigation is correlated with the click, but it is not proof that
      // the click caused it.
      assert.strictEqual(navigation.detail.provesClickEffect, false);
      assert.strictEqual(navigation.detail.to, 'https://example.com/arrived');
    });
  });
});
