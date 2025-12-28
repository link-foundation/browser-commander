/**
 * Browser Commander - Function Binding Helpers
 * This module provides helper functions for binding page, engine, and log to library functions.
 */

import { wait, evaluate, safeEvaluate } from './utilities/wait.js';
import { getUrl, unfocusAddressBar } from './utilities/url.js';
import {
  waitForUrlStabilization,
  goto,
  waitForNavigation,
  waitForPageReady,
  waitAfterAction,
} from './browser/navigation.js';
import {
  createPlaywrightLocator,
  getLocatorOrElement,
  waitForLocatorOrElement,
  waitForVisible,
  locator,
} from './elements/locators.js';
import {
  querySelector,
  querySelectorAll,
  findByText,
  normalizeSelector,
  waitForSelector,
  withTextSelectorSupport,
} from './elements/selectors.js';
import { isVisible, isEnabled, count } from './elements/visibility.js';
import {
  textContent,
  inputValue,
  getAttribute,
  getInputValue,
  logElementInfo,
} from './elements/content.js';
import {
  scrollIntoView,
  needsScrolling,
  scrollIntoViewIfNeeded,
} from './interactions/scroll.js';
import { clickElement, clickButton } from './interactions/click.js';
import {
  checkIfElementEmpty,
  performFill,
  fillTextArea,
} from './interactions/fill.js';
import {
  waitForUrlCondition,
  installClickListener,
  checkAndClearFlag,
  findToggleButton,
} from './high-level/universal-logic.js';

/**
 * Create bound functions for a browser commander instance
 * @param {Object} options - Configuration
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Function} options.log - Logger instance
 * @param {boolean} options.verbose - Enable verbose logging
 * @param {Object} options.navigationManager - NavigationManager instance (optional)
 * @param {Object} options.networkTracker - NetworkTracker instance (optional)
 * @returns {Object} - Object containing all bound functions
 */
export function createBoundFunctions(options = {}) {
  const {
    page,
    engine,
    log,
    verbose = false,
    navigationManager,
    networkTracker,
  } = options;

  // Create bound helper functions that inject page, engine, log
  // Wait function now automatically gets abort signal from navigation manager
  const waitBound = (opts) => {
    const abortSignal = navigationManager
      ? navigationManager.getAbortSignal()
      : null;
    return wait({ ...opts, log, abortSignal: opts.abortSignal || abortSignal });
  };
  const evaluateBound = (opts) => evaluate({ ...opts, page, engine });
  const safeEvaluateBound = (opts) => safeEvaluate({ ...opts, page, engine });
  const getUrlBound = () => getUrl({ page });
  const unfocusAddressBarBound = (opts = {}) =>
    unfocusAddressBar({ ...opts, page });

  // Bound navigation - with NavigationManager integration
  const waitForUrlStabilizationBound = (opts) =>
    waitForUrlStabilization({
      ...opts,
      page,
      log,
      wait: waitBound,
      navigationManager,
    });
  const gotoBound = (opts) =>
    goto({
      ...opts,
      page,
      waitForUrlStabilization: waitForUrlStabilizationBound,
      navigationManager,
    });
  const waitForNavigationBound = (opts) =>
    waitForNavigation({
      ...opts,
      page,
      navigationManager,
    });
  const waitForPageReadyBound = (opts) =>
    waitForPageReady({
      ...opts,
      page,
      navigationManager,
      networkTracker,
      log,
      wait: waitBound,
    });
  const waitAfterActionBound = (opts) =>
    waitAfterAction({
      ...opts,
      page,
      navigationManager,
      networkTracker,
      log,
      wait: waitBound,
    });

  // Bound locators
  const createPlaywrightLocatorBound = (opts) =>
    createPlaywrightLocator({ ...opts, page });
  const getLocatorOrElementBound = (opts) =>
    getLocatorOrElement({ ...opts, page, engine });
  const waitForLocatorOrElementBound = (opts) =>
    waitForLocatorOrElement({ ...opts, page, engine });
  const waitForVisibleBound = (opts) => waitForVisible({ ...opts, engine });
  const locatorBound = (opts) => locator({ ...opts, page, engine });

  // Bound selectors
  const querySelectorBound = (opts) => querySelector({ ...opts, page, engine });
  const querySelectorAllBound = (opts) =>
    querySelectorAll({ ...opts, page, engine });
  const findByTextBound = (opts) => findByText({ ...opts, engine });
  const normalizeSelectorBound = (opts) => normalizeSelector({ ...opts, page });
  const waitForSelectorBound = (opts) =>
    waitForSelector({ ...opts, page, engine });

  // Bound visibility
  const isVisibleBound = (opts) => isVisible({ ...opts, page, engine });
  const isEnabledBound = (opts) => isEnabled({ ...opts, page, engine });
  const countBound = (opts) => count({ ...opts, page, engine });

  // Bound content
  const textContentBound = (opts) => textContent({ ...opts, page, engine });
  const inputValueBound = (opts) => inputValue({ ...opts, page, engine });
  const getAttributeBound = (opts) => getAttribute({ ...opts, page, engine });
  const getInputValueBound = (opts) => getInputValue({ ...opts, page, engine });
  const logElementInfoBound = (opts) =>
    logElementInfo({ ...opts, page, engine, log });

  // Bound scroll
  const scrollIntoViewBound = (opts) =>
    scrollIntoView({ ...opts, page, engine });
  const needsScrollingBound = (opts) =>
    needsScrolling({ ...opts, page, engine });
  const scrollIntoViewIfNeededBound = (opts) =>
    scrollIntoViewIfNeeded({ ...opts, page, engine, wait: waitBound, log });

  // Bound click - now navigation-aware
  const clickElementBound = (opts) => clickElement({ ...opts, engine, log });
  const clickButtonBound = (opts) =>
    clickButton({
      ...opts,
      page,
      engine,
      wait: waitBound,
      log,
      verbose,
      navigationManager,
      networkTracker,
    });

  // Bound fill
  const checkIfElementEmptyBound = (opts) =>
    checkIfElementEmpty({ ...opts, page, engine });
  const performFillBound = (opts) => performFill({ ...opts, page, engine });
  const fillTextAreaBound = (opts) =>
    fillTextArea({ ...opts, page, engine, wait: waitBound, log });

  // Bound high-level
  const waitForUrlConditionBound = (opts) =>
    waitForUrlCondition({
      ...opts,
      getUrl: getUrlBound,
      wait: waitBound,
      evaluate: evaluateBound,
    });
  const installClickListenerBound = (opts) =>
    installClickListener({ ...opts, evaluate: evaluateBound });
  const checkAndClearFlagBound = (opts) =>
    checkAndClearFlag({ ...opts, evaluate: evaluateBound });
  const findToggleButtonBound = (opts) =>
    findToggleButton({
      ...opts,
      count: countBound,
      findByText: findByTextBound,
    });

  // Wrap functions with text selector support
  const fillTextAreaWrapped = withTextSelectorSupport(
    fillTextAreaBound,
    engine,
    page
  );
  const clickButtonWrapped = withTextSelectorSupport(
    clickButtonBound,
    engine,
    page
  );
  const getAttributeWrapped = withTextSelectorSupport(
    getAttributeBound,
    engine,
    page
  );
  const isVisibleWrapped = withTextSelectorSupport(
    isVisibleBound,
    engine,
    page
  );
  const isEnabledWrapped = withTextSelectorSupport(
    isEnabledBound,
    engine,
    page
  );
  const textContentWrapped = withTextSelectorSupport(
    textContentBound,
    engine,
    page
  );
  const inputValueWrapped = withTextSelectorSupport(
    inputValueBound,
    engine,
    page
  );

  return {
    // Helper functions (now public)
    createPlaywrightLocator: createPlaywrightLocatorBound,
    getLocatorOrElement: getLocatorOrElementBound,
    waitForLocatorOrElement: waitForLocatorOrElementBound,
    scrollIntoView: scrollIntoViewBound,
    scrollIntoViewIfNeeded: scrollIntoViewIfNeededBound,
    needsScrolling: needsScrollingBound,
    checkIfElementEmpty: checkIfElementEmptyBound,
    performFill: performFillBound,
    logElementInfo: logElementInfoBound,
    normalizeSelector: normalizeSelectorBound,
    withTextSelectorSupport: (fn) => withTextSelectorSupport(fn, engine, page),
    waitForVisible: waitForVisibleBound,
    clickElement: clickElementBound,
    getInputValue: getInputValueBound,
    unfocusAddressBar: unfocusAddressBarBound,

    // Main API functions
    wait: waitBound,
    fillTextArea: fillTextAreaWrapped,
    clickButton: clickButtonWrapped,
    evaluate: evaluateBound,
    safeEvaluate: safeEvaluateBound,
    waitForSelector: waitForSelectorBound,
    querySelector: querySelectorBound,
    querySelectorAll: querySelectorAllBound,
    waitForUrlStabilization: waitForUrlStabilizationBound,
    goto: gotoBound,
    getUrl: getUrlBound,
    waitForNavigation: waitForNavigationBound,
    waitForPageReady: waitForPageReadyBound,
    waitAfterAction: waitAfterActionBound,
    getAttribute: getAttributeWrapped,
    isVisible: isVisibleWrapped,
    isEnabled: isEnabledWrapped,
    count: countBound,
    textContent: textContentWrapped,
    inputValue: inputValueWrapped,
    locator: locatorBound,
    findByText: findByTextBound,

    // Universal High-Level Functions (DRY Principle)
    waitForUrlCondition: waitForUrlConditionBound,
    installClickListener: installClickListenerBound,
    checkAndClearFlag: checkAndClearFlagBound,
    findToggleButton: findToggleButtonBound,
  };
}
