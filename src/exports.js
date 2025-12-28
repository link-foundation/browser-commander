/**
 * Browser Commander - Public API exports
 * This module centralizes all public exports from the browser-commander library.
 */

// Re-export core utilities
export { CHROME_ARGS, TIMING } from './core/constants.js';
export { isVerboseEnabled, createLogger } from './core/logger.js';
export { disableTranslateInPreferences } from './core/preferences.js';
export { detectEngine } from './core/engine-detection.js';
export {
  isNavigationError,
  safeOperation,
  makeNavigationSafe,
  withNavigationSafety,
} from './core/navigation-safety.js';

// Re-export new core components
export { createNetworkTracker } from './core/network-tracker.js';
export { createNavigationManager } from './core/navigation-manager.js';
export { createPageSessionFactory } from './core/page-session.js';

// Re-export engine adapter
export {
  EngineAdapter,
  PlaywrightAdapter,
  PuppeteerAdapter,
  createEngineAdapter,
} from './core/engine-adapter.js';

// Page trigger system
export {
  createPageTriggerManager,
  ActionStoppedError,
  isActionStoppedError,
  makeUrlCondition,
  allConditions,
  anyCondition,
  notCondition,
} from './core/page-trigger-manager.js';

// Re-export browser management
export { launchBrowser } from './browser/launcher.js';
export {
  waitForUrlStabilization,
  goto,
  waitForNavigation,
  waitForPageReady,
  waitAfterAction,
  // Navigation verification
  defaultNavigationVerification,
  verifyNavigation,
} from './browser/navigation.js';

// Re-export element operations
export {
  createPlaywrightLocator,
  getLocatorOrElement,
  waitForLocatorOrElement,
  waitForVisible,
  locator,
} from './elements/locators.js';

export {
  querySelector,
  querySelectorAll,
  findByText,
  normalizeSelector,
  withTextSelectorSupport,
  waitForSelector,
} from './elements/selectors.js';

export { isVisible, isEnabled, count } from './elements/visibility.js';

export {
  textContent,
  inputValue,
  getAttribute,
  getInputValue,
  logElementInfo,
} from './elements/content.js';

// Re-export interactions
export {
  scrollIntoView,
  needsScrolling,
  scrollIntoViewIfNeeded,
  // Scroll verification
  defaultScrollVerification,
  verifyScroll,
} from './interactions/scroll.js';

export {
  clickElement,
  clickButton,
  // Click verification
  defaultClickVerification,
  capturePreClickState,
  verifyClick,
} from './interactions/click.js';

export {
  checkIfElementEmpty,
  performFill,
  fillTextArea,
  // Fill verification
  defaultFillVerification,
  verifyFill,
} from './interactions/fill.js';

// Re-export utilities
export { wait, evaluate, safeEvaluate } from './utilities/wait.js';
export { getUrl, unfocusAddressBar } from './utilities/url.js';

// Re-export high-level universal logic
export {
  waitForUrlCondition,
  installClickListener,
  checkAndClearFlag,
  findToggleButton,
} from './high-level/universal-logic.js';
