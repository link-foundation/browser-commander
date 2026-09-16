/**
 * A budget for one capture (issue #87).
 *
 * A page that stopped answering must cost the trace one record, not the run.
 */

/**
 * Run a capture with its own deadline.
 *
 * @param {Promise} work - The capture
 * @param {number} timeoutMs - Budget in milliseconds; falsy means no deadline
 * @param {string} what - Name used in the timeout message
 * @returns {Promise<*>} The capture's result
 */
export async function withDeadline(work, timeoutMs, what) {
  if (!timeoutMs) {
    return work;
  }
  let timer;
  try {
    return await Promise.race([
      work,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${what} timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
