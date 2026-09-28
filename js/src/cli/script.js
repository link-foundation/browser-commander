/**
 * `browser-commander run <script.json>`: execute a command script through the
 * same dispatcher as `serve --stdio` (docs/cli-and-bridge.md,
 * "Command scripts").
 */
import { createDispatcher, substituteSession } from './dispatcher.js';
import { toRpcError } from './rpc-error.js';

/**
 * Check the script shape: `{"steps": [{"method": "…", "params": {…}}]}`.
 *
 * @param {unknown} script
 * @returns {Object[]} The steps
 */
export function validateScript(script) {
  const steps = script?.steps;
  if (!Array.isArray(steps)) {
    throw new TypeError('A command script must be {"steps": [...]}');
  }
  steps.forEach((step, index) => {
    if (typeof step?.method !== 'string') {
      throw new TypeError(`Step ${index + 1} has no "method"`);
    }
  });
  return steps;
}

async function runStep(dispatcher, step, params) {
  try {
    return {
      method: step.method,
      result: (await dispatcher.dispatch(step.method, params)) ?? null,
    };
  } catch (error) {
    // Stacks differ between machines and languages; the name and message
    // are what the cross-language comparison needs.
    return { method: step.method, error: toRpcError(error, { stack: false }) };
  }
}

/**
 * Run every step in order. A failed step is recorded and the script goes on,
 * so later steps (such as `session.close`) still run. Sessions left open are
 * closed at the end.
 *
 * @param {Object} script - The parsed command script
 * @param {Object} [options]
 * @param {Object} [options.dependencies] - Dispatcher dependencies (tests)
 * @param {Object} [options.launchDefaults] - `session.launch` params used when a step leaves them out
 * @returns {Promise<{results: Object[], failed: boolean}>}
 */
export async function runScript(script, options = {}) {
  const { dependencies, launchDefaults = {} } = options;
  const steps = validateScript(script);
  const dispatcher = createDispatcher({ dependencies });
  const results = [];
  let latestSession = null;
  try {
    for (const step of steps) {
      const params = substituteSession(step.params ?? {}, latestSession);
      const entry = await runStep(
        dispatcher,
        step,
        step.method === 'session.launch'
          ? { ...launchDefaults, ...params }
          : params
      );
      if (typeof entry.result?.session === 'string') {
        latestSession = entry.result.session;
      }
      results.push(entry);
    }
  } finally {
    await dispatcher.close();
  }
  return { results, failed: results.some((entry) => 'error' in entry) };
}
