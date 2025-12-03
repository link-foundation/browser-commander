/**
 * Browser Commander - Universal browser automation library
 * Supports both Playwright and Puppeteer with a unified API
 * All functions use options objects for easy maintenance
 *
 * Key features:
 * - Automatic network request tracking
 * - Navigation-aware operations (wait for page ready after navigations)
 * - Event-based page lifecycle management
 * - Session management for per-page automation logic
 */

// Export the factory function
export { makeBrowserCommander } from './factory.js';

// Re-export all public APIs from exports module
export * from './exports.js';
