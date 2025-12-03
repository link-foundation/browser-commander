/**
 * Browser Commander - Factory Function
 * This module provides the makeBrowserCommander factory function that creates
 * a browser commander instance with all bound methods.
 */

import { createLogger } from './core/logger.js';
import { detectEngine } from './core/engine-detection.js';
import { createNetworkTracker } from './core/network-tracker.js';
import { createNavigationManager } from './core/navigation-manager.js';
import { createPageSessionFactory } from './core/page-session.js';
import {
  createPageTriggerManager,
  ActionStoppedError,
  isActionStoppedError,
  makeUrlCondition,
  allConditions,
  anyCondition,
  notCondition,
} from './core/page-trigger-manager.js';
import { createBoundFunctions } from './bindings.js';

/**
 * Create a browser commander instance for a specific page
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Playwright or Puppeteer page object
 * @param {boolean} options.verbose - Enable verbose logging
 * @param {boolean} options.enableNetworkTracking - Enable network request tracking (default: true)
 * @param {boolean} options.enableNavigationManager - Enable navigation manager (default: true)
 * @returns {Object} - Browser commander API
 */
export function makeBrowserCommander(options = {}) {
  const {
    page,
    verbose = false,
    enableNetworkTracking = true,
    enableNavigationManager = true,
  } = options;

  if (!page) {
    throw new Error('page is required in options');
  }

  const engine = detectEngine(page);
  const log = createLogger({ verbose });

  // Create NetworkTracker if enabled
  // Use 30 second idle timeout to ensure page is fully loaded
  let networkTracker = null;
  if (enableNetworkTracking) {
    networkTracker = createNetworkTracker({
      page,
      engine,
      log,
      idleTimeout: 30000, // Wait 30 seconds without requests before considering network idle
    });
    networkTracker.startTracking();
  }

  // Create NavigationManager if enabled
  let navigationManager = null;
  let sessionFactory = null;

  // PageTriggerManager (will be initialized after commander is created)
  let pageTriggerManager = null;

  if (enableNavigationManager) {
    navigationManager = createNavigationManager({
      page,
      engine,
      log,
      networkTracker,
    });
    navigationManager.startListening();

    // Create PageSession factory
    sessionFactory = createPageSessionFactory({
      navigationManager,
      networkTracker,
      log,
    });

    // Create PageTriggerManager
    pageTriggerManager = createPageTriggerManager({
      navigationManager,
      log,
    });
  }

  // Create all bound functions
  const boundFunctions = createBoundFunctions({
    page,
    engine,
    log,
    verbose,
    navigationManager,
    networkTracker,
  });

  // Cleanup function
  const destroy = async () => {
    if (pageTriggerManager) {
      await pageTriggerManager.destroy();
    }
    if (networkTracker) {
      networkTracker.stopTracking();
    }
    if (navigationManager) {
      navigationManager.stopListening();
    }
    if (sessionFactory) {
      await sessionFactory.endAllSessions();
    }
  };

  // Build commander object
  const commander = {
    // Core properties
    engine,
    page,
    log,

    // Navigation management components
    networkTracker,
    navigationManager,
    sessionFactory,
    pageTriggerManager,

    // All bound functions
    ...boundFunctions,

    // Lifecycle
    destroy,

    // Convenience methods for page sessions (legacy API)
    createSession: sessionFactory ? (opts) => sessionFactory.createSession(opts) : null,
    getActiveSessions: sessionFactory ? () => sessionFactory.getActiveSessions() : () => [],

    // Subscribe to navigation events (legacy API)
    onNavigationStart: navigationManager ? (fn) => navigationManager.on('onNavigationStart', fn) : () => {},
    onNavigationComplete: navigationManager ? (fn) => navigationManager.on('onNavigationComplete', fn) : () => {},
    onUrlChange: navigationManager ? (fn) => navigationManager.on('onUrlChange', fn) : () => {},
    onPageReady: navigationManager ? (fn) => navigationManager.on('onPageReady', fn) : () => {},

    // Abort handling - check these to stop operations when navigation occurs
    shouldAbort: navigationManager ? () => navigationManager.shouldAbort() : () => false,
    getAbortSignal: navigationManager ? () => navigationManager.getAbortSignal() : () => null,

    // Page Trigger API
    // Register a trigger: commander.pageTrigger({ condition, action, name })
    // condition receives context: { url, commander }
    // action receives context: { url, commander, checkStopped, forEach, wait, onCleanup, ... }
    pageTrigger: pageTriggerManager
      ? (config) => pageTriggerManager.pageTrigger(config)
      : () => { throw new Error('pageTrigger requires enableNavigationManager: true'); },

    // URL condition helpers
    makeUrlCondition,
    allConditions,
    anyCondition,
    notCondition,

    // Error classes for action control flow
    ActionStoppedError,
    isActionStoppedError,
  };

  // Initialize PageTriggerManager with the commander
  if (pageTriggerManager) {
    pageTriggerManager.initialize(commander);
  }

  return commander;
}
