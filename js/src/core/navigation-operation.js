import { runWithinDeadline } from './readiness.js';

/** Stable outcome for cancellation or an exhausted operation budget. */
export class NavigationStoppedError extends Error {
  constructor(status) {
    super(
      status === 'interrupted'
        ? 'Navigation interrupted'
        : 'Navigation timed out'
    );
    this.name = 'NavigationStoppedError';
    this.status = status;
  }
}

/** Bound every navigation phase by the same deadline and caller signal. */
export async function navigationPhase(deadline, run) {
  const result = await runWithinDeadline(deadline, run);
  if (result.interrupted || result.timedOut) {
    throw new NavigationStoppedError(
      result.interrupted ? 'interrupted' : 'timed_out'
    );
  }
  return result.value;
}
