import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CLICK_ACTIVATION,
  CLICK_SCROLL,
  CLICK_ACTIONABILITY,
  ScrollConstraintError,
  resolveActivationOptions,
  measureClickPoint,
  readScrollPosition,
  restoreScrollPosition,
  dispatchClick,
} from '../../../src/interactions/click-activation.js';
import { createMockLogger } from '../../helpers/mocks.js';
import {
  IN_VIEWPORT_POINT,
  createScrollModel,
} from '../../helpers/click-fixtures.js';

/**
 * Adapter stub that records what the engine was asked to do and models a
 * scroll position the engine may move.
 *
 * @param {Object} [options] - Stub configuration
 * @param {Object} [options.point] - Geometry returned by the click-point probe
 * @param {number} [options.scrollOnClick] - Scroll position the engine click lands on
 * @param {boolean} [options.hasEvaluateOnPage] - Whether the adapter exposes `evaluateOnPage`
 * @returns {Object} Adapter stub
 */
function createAdapter(options = {}) {
  const {
    point = IN_VIEWPORT_POINT,
    scrollOnClick = 0,
    hasEvaluateOnPage = true,
  } = options;

  const calls = { click: [], domClick: 0 };
  const scroll = createScrollModel();

  const adapter = {
    calls,
    click: async (el, opts) => {
      calls.click.push(opts);
      scroll.set(scrollOnClick);
    },
    evaluateOnElement: async (el, fn) => {
      if (typeof fn === 'function' && fn.length === 1) {
        // The DOM-activation path passes `el => el.click()`.
        const source = fn.toString();
        if (source.includes('.click()')) {
          calls.domClick += 1;
          return undefined;
        }
      }
      return { ...point, scroll: { x: 0, y: scroll.current() } };
    },
  };

  if (hasEvaluateOnPage) {
    adapter.evaluateOnPage = scroll.evaluateOnPage;
  }

  adapter.currentScrollY = scroll.current;
  return adapter;
}

/**
 * Page stub that records real pointer clicks.
 *
 * @returns {Object} Page stub
 */
function createPage() {
  const clicks = [];
  return { clicks, mouse: { click: async (x, y) => clicks.push({ x, y }) } };
}

/**
 * Build the page/adapter pair and a `dispatchClick` invoker for one scenario.
 *
 * @param {Object} [options] - Scenario configuration
 * @param {Object} [options.adapter] - Options forwarded to {@link createAdapter}
 * @param {Object} [options.activation] - Options forwarded to `resolveActivationOptions`
 * @returns {{page: Object, adapter: Object, dispatch: Function}} Scenario handle
 */
function scenario(options = {}) {
  const page = createPage();
  const adapter = createAdapter(options.adapter);

  const dispatch = () =>
    dispatchClick({
      page,
      adapter,
      locatorOrElement: {},
      activationOptions: resolveActivationOptions(options.activation),
    });

  return { page, adapter, dispatch };
}

describe('click activation', () => {
  describe('resolveActivationOptions', () => {
    it('should default to a pointer click that may scroll', () => {
      const resolved = resolveActivationOptions();
      assert.strictEqual(resolved.activation, CLICK_ACTIVATION.POINTER);
      assert.strictEqual(resolved.scroll, CLICK_SCROLL.AUTO);
      assert.strictEqual(resolved.actionability, CLICK_ACTIONABILITY.NORMAL);
      assert.deepStrictEqual(resolved.deprecations, []);
    });

    it('should map the deprecated noAutoScroll onto scroll semantics', () => {
      // Regression test for issue #89: noAutoScroll used to mean
      // `{ force: true }`, which is an actionability flag, not a scroll flag.
      const on = resolveActivationOptions({ noAutoScroll: true });
      assert.strictEqual(on.scroll, CLICK_SCROLL.NONE);
      assert.strictEqual(on.actionability, CLICK_ACTIONABILITY.NORMAL);
      assert.strictEqual(on.deprecations.length, 1);
      assert.ok(on.deprecations[0].includes('noAutoScroll is deprecated'));

      const off = resolveActivationOptions({ noAutoScroll: false });
      assert.strictEqual(off.scroll, CLICK_SCROLL.AUTO);
    });

    it('should let an explicit scroll option win over noAutoScroll', () => {
      const resolved = resolveActivationOptions({
        noAutoScroll: true,
        scroll: CLICK_SCROLL.PRESERVE,
      });
      assert.strictEqual(resolved.scroll, CLICK_SCROLL.PRESERVE);
    });

    it('should log the deprecation notice when a logger is supplied', () => {
      const log = createMockLogger({ collectLogs: true });
      resolveActivationOptions({ noAutoScroll: true, log });
      const messages = log.getLogs().map((entry) => entry.message);
      assert.ok(messages.some((message) => message.includes('deprecated')));
    });

    it('should reject unknown values on every axis', () => {
      assert.throws(
        () => resolveActivationOptions({ activation: 'telepathy' }),
        /activation must be one of/u
      );
      assert.throws(
        () => resolveActivationOptions({ scroll: 'maybe' }),
        /scroll must be one of/u
      );
      assert.throws(
        () => resolveActivationOptions({ actionability: 'hard' }),
        /actionability must be one of/u
      );
    });
  });

  describe('measureClickPoint', () => {
    it('should report the element centre and hit-test result', async () => {
      const adapter = createAdapter();
      const point = await measureClickPoint({
        adapter,
        locatorOrElement: {},
      });
      assert.strictEqual(point.x, 50);
      assert.strictEqual(point.y, 60);
      assert.strictEqual(point.inViewport, true);
      assert.strictEqual(point.hitsTarget, true);
    });
  });

  describe('scroll position helpers', () => {
    it('should tolerate an adapter without evaluateOnPage', async () => {
      const adapter = createAdapter({ hasEvaluateOnPage: false });
      assert.strictEqual(await readScrollPosition(adapter), null);
      await restoreScrollPosition(adapter, { x: 0, y: 10 });
    });

    it('should tolerate an adapter that throws', async () => {
      const adapter = {
        evaluateOnPage: async () => {
          throw new Error('context destroyed');
        },
      };
      assert.strictEqual(await readScrollPosition(adapter), null);
    });

    it('should do nothing when there is no position to restore', async () => {
      const adapter = createAdapter();
      await restoreScrollPosition(adapter, null);
      assert.strictEqual(adapter.currentScrollY(), 0);
    });
  });

  describe('dispatchClick', () => {
    it('should send force to the engine only for actionability: force', async () => {
      const normal = scenario();
      await normal.dispatch();
      assert.deepStrictEqual(normal.adapter.calls.click, [{}]);

      const forced = scenario({
        activation: { actionability: CLICK_ACTIONABILITY.FORCE },
      });
      await forced.dispatch();
      assert.deepStrictEqual(forced.adapter.calls.click, [{ force: true }]);
    });

    it('should restore the scroll position for scroll: preserve', async () => {
      // The engine is free to scroll; the caller asked for the viewport to end
      // up where it started.
      const { adapter, dispatch } = scenario({
        adapter: { scrollOnClick: 3911 },
        activation: { scroll: CLICK_SCROLL.PRESERVE },
      });

      const detail = await dispatch();

      assert.strictEqual(adapter.currentScrollY(), 0);
      assert.strictEqual(detail.scrollAfter.y, 0);
    });

    it('should use a real pointer at the element point for scroll: none', async () => {
      // Regression test for issue #89: `{ force: true }` still scrolled
      // (scrollY 0 -> 3911 in the live repro). A mouse click at the measured
      // point cannot scroll at all.
      const { page, adapter, dispatch } = scenario({
        adapter: { scrollOnClick: 3911 },
        activation: { scroll: CLICK_SCROLL.NONE },
      });

      const detail = await dispatch();

      assert.deepStrictEqual(page.clicks, [{ x: 50, y: 60 }]);
      assert.deepStrictEqual(adapter.calls.click, []);
      assert.strictEqual(adapter.currentScrollY(), 0);
      assert.strictEqual(detail.scrollBefore.y, detail.scrollAfter.y);
    });

    it('should refuse scroll: none when the element is off-screen', async () => {
      const { page, dispatch } = scenario({
        adapter: {
          point: {
            ...IN_VIEWPORT_POINT,
            y: 4000,
            top: 3980,
            inViewport: false,
            hitsTarget: false,
          },
        },
        activation: { scroll: CLICK_SCROLL.NONE },
      });

      await assert.rejects(dispatch, (error) => {
        assert.ok(error instanceof ScrollConstraintError);
        assert.ok(error.message.includes('outside the viewport'));
        assert.ok(error.message.includes('scroll: "preserve"'));
        assert.strictEqual(error.detail.inViewport, false);
        return true;
      });
      assert.deepStrictEqual(page.clicks, []);
    });

    it('should refuse scroll: none when another element covers the target', async () => {
      const { page, dispatch } = scenario({
        adapter: { point: { ...IN_VIEWPORT_POINT, hitsTarget: false } },
        activation: { scroll: CLICK_SCROLL.NONE },
      });

      await assert.rejects(dispatch, /covers the target/u);
      assert.deepStrictEqual(page.clicks, []);
    });

    it('should dispatch an untrusted DOM click for activation: dom', async () => {
      const { page, adapter, dispatch } = scenario({
        activation: { activation: CLICK_ACTIVATION.DOM },
      });

      const detail = await dispatch();

      assert.strictEqual(adapter.calls.domClick, 1);
      assert.deepStrictEqual(adapter.calls.click, []);
      assert.deepStrictEqual(page.clicks, []);
      assert.strictEqual(detail.mode, CLICK_ACTIVATION.DOM);
      assert.strictEqual(detail.point, null);
    });
  });
});
