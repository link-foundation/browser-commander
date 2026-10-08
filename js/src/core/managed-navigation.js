import { createDeadline, urlStableFor, networkIdleFor } from './readiness.js';
import { navigationPhase } from './navigation-operation.js';
import { isNavigationError } from './navigation-safety.js';

/** Own a controlled navigation's deadline, policy and cancellation lifecycle. */
export function createManagedNavigator({
  page,
  state,
  config,
  waitForReady,
  triggerNavigationStart,
  updateCurrentUrl,
  abandonNavigation,
}) {
  async function navigate(opts = {}) {
    const { url, waitUntil = 'domcontentloaded', timeout = 60000 } = opts;
    if (!url) {
      throw new Error('url is required in options');
    }
    state.activeOperation?.controller.abort();
    const controller = new AbortController();
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, controller.signal])
      : controller.signal;
    const deadline = opts.deadline ?? createDeadline({ timeout, signal });
    // Keep a caller-provided deadline's clock, adding operation cancellation.
    const budget = { ...deadline, signal };
    const operation = { controller };
    state.activeOperation = operation;
    const stable = () =>
      urlStableFor({
        stableForMs:
          opts.checkInterval === undefined
            ? config.redirectStabilizationTime
            : opts.checkInterval,
        intervalMs: opts.checkInterval ?? 200,
        consecutiveSamples: opts.stableChecks ?? 1,
      });
    try {
      if (opts.waitForStableUrlBefore === true) {
        const before = await waitForReady({
          checks: [stable()],
          deadline: budget,
          reason: 'before goto',
          observeOnly: true,
        });
        if (!before.ready) {
          state.lastOutcome = before;
          return opts.returnOutcome ? before : false;
        }
      }
      await navigationPhase(budget, () =>
        triggerNavigationStart({ url, isExternal: false, signal })
      );
      await navigationPhase(budget, () =>
        page.goto(url, {
          waitUntil,
          timeout: Math.max(1, budget.remainingMs()),
        })
      );
      updateCurrentUrl();
      const checks = opts.checks ?? [
        ...(opts.waitForStableUrlAfter === false ? [] : [stable()]),
        ...(opts.waitForNetworkIdle === false ? [] : [networkIdleFor()]),
      ];
      state.lastOutcome = await waitForReady({
        deadline: budget,
        checks,
        reason: 'after goto',
        shouldNotify: () => state.activeOperation === operation,
      });
      return opts.returnOutcome ? state.lastOutcome : state.lastOutcome.ready;
    } catch (error) {
      if (
        error.status ||
        isNavigationError(error) ||
        error.name === 'TimeoutError'
      ) {
        const status =
          error.status ??
          (error.name === 'TimeoutError' ? 'timed_out' : 'interrupted');
        state.lastOutcome = {
          ready: false,
          status,
          reason: error.message,
          elapsedMs: budget.elapsedMs(),
        };
        return opts.returnOutcome ? state.lastOutcome : false;
      }
      throw error;
    } finally {
      controller.abort();
      if (state.activeOperation === operation) {
        state.activeOperation = null;
        abandonNavigation('operation finished');
      }
    }
  }

  return navigate;
}
