import { captureSnapshotInPage } from './page-capture.js';
import { withDeadline } from './deadline.js';
import { redactText, redactValue, redactUrl, REDACTED } from './redaction.js';
import { TRACE_EVENT, TRACE_DROP_REASON } from './schema.js';
export function createCheckpointRecorder({
  isStopped,
  captureState,
  mutations,
  evaluateInPage,
  privacyOptions,
  domOptions,
  links,
  limits,
  captureTimeoutMs,
  bundle,
  screenshot,
  checkpoints,
  record,
}) {
  /**
   * Capture a named checkpoint.
   *
   * @param {string} name - What this moment is
   * @param {Object} [checkpointOptions] - `{actor, reason, screenshots}`
   * @returns {Promise<Object|null>} `{index, name, members}`
   */
  async function checkpoint(name, checkpointOptions = {}) {
    if (isStopped()) {
      throw new Error('this trace has already been stopped');
    }

    const { actor = 'automation', reason = 'checkpoint' } = checkpointOptions;
    const index = ++captureState.index;

    // Mutations are drained first so the batches belong to the interval that
    // ended here, not to the one that starts now.
    await mutations.drain(index - 1 > 0 ? index - 1 : 0);

    let captured = null;
    try {
      captured = await withDeadline(
        evaluateInPage(captureSnapshotInPage, {
          redactSelectors: privacyOptions.redactSelectors,
          redactAttributes: privacyOptions.redactAttributes,
          useDefaults: privacyOptions.useDefaults,
          redacted: REDACTED,
          html: domOptions.html,
          liveControlState: domOptions.liveControlState,
          openShadowRoots: domOptions.openShadowRoots,
          ignoreSelectors: domOptions.ignoreSelectors ?? [],
          captureText: links?.dom === 'text',
          maxHtmlBytes: limits.maxHtmlBytes ?? 4 * 1024 * 1024,
        }),
        captureTimeoutMs,
        'trace checkpoint capture'
      );
    } catch (error) {
      await bundle.drop({
        reason: /closed/i.test(error.message)
          ? TRACE_DROP_REASON.PAGE_CLOSED
          : TRACE_DROP_REASON.CAPTURE_FAILED,
        member: `checkpoints/${index}`,
        detail: error.message,
      });
    }

    const shot = await screenshot(reason);
    const state = captured?.state
      ? redactValue(captured.state, privacyOptions)
      : null;

    const members = await bundle.writeCheckpoint({
      index,
      html: redactText(captured?.html, privacyOptions, {
        kind: 'dom',
        name: 'html',
      }),
      state: state ? { ...state, name, actor, reason } : undefined,
      screenshot: shot ?? undefined,
    });

    const entry = {
      index,
      name,
      actor,
      reason,
      url: state ? redactUrl(state.url, privacyOptions) : null,
      truncated: Boolean(captured?.truncated),
      members,
    };
    checkpoints.push(entry);
    await record(TRACE_EVENT.CHECKPOINT, entry);

    // The init script covers every document created from here on; this covers
    // a frame that was attached without one, which is cheap because installing
    // over a recorder that is already observing does nothing.
    await mutations.install();

    return entry;
  }

  return checkpoint;
}
