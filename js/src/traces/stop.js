import { createManifest, TRACE_EVENT, TRACE_OUTCOME } from './schema.js';
import { readTrace } from './reader.js';
import { writeHar } from './network.js';
import { gzipTrace } from './storage.js';
import { abortTraceStart } from './start-cleanup.js';
export function createTraceStop(context) {
  const {
    getStopped,
    setStopped,
    options,
    detachers,
    navigationCapture,
    video,
    detachNetwork,
  } = context;
  const {
    mutations,
    captureState,
    record,
    note,
    bundle,
    checkpoints,
    linksSink,
    network,
  } = context;
  const {
    recorderMode,
    startedAt,
    now,
    commanderVersion,
    engine,
    domOptions,
    eventSources,
    privacyOptions,
    limits,
  } = context;
  let stopping;
  async function stop(stopOptions = {}) {
    if (getStopped()) {
      return getStopped();
    }
    const { discard = false, error = null } = stopOptions;

    {
      for (const detach of detachers.splice(0)) {
        try {
          await detach();
        } catch (error) {
          note(`could not detach a listener: ${error.message}`);
        }
      }
      await navigationCapture();
    }
    if (video) {
      const recording = await video.stop();
      if (recording.bytes) {
        await bundle.writeMember(
          `recording.${recording.format}`,
          recording.bytes
        );
      }
    }
    await detachNetwork();
    await mutations.drain(captureState.index);
    if (error) {
      await record(TRACE_EVENT.PAGE_ERROR, {
        message: error.message ?? String(error),
        stack: error.stack ?? null,
        fatal: true,
      });
    }
    await record(TRACE_EVENT.TRACE_STOP, { discarded: discard });
    setStopped(true);

    // The documents that exist stop observing here; the engine's init-script
    // registration is removed with the detachers below.
    await mutations.stop();

    for (const detach of detachers.reverse()) {
      try {
        await detach();
      } catch (detachError) {
        note(`could not detach a listener: ${detachError.message}`);
      }
    }

    const manifest = await bundle.close(
      createManifest({
        mode: recorderMode,
        startedAt,
        stoppedAt: new Date(now()).toISOString(),
        outcome: TRACE_OUTCOME.COMPLETE,
        commanderVersion,
        engine,
        dom: domOptions,
        events: eventSources,
        replay: {
          checkpoints: true,
          mutations: Boolean(domOptions.mutations),
          childListPositions: Boolean(domOptions.mutations),
          liveState:
            Boolean(domOptions.mutations) && domOptions.liveState !== false,
          identifiers: true,
        },
        privacy: {
          redactSelectors: privacyOptions.redactSelectors,
          redactAttributes: privacyOptions.redactAttributes,
          redactQueryParams: privacyOptions.redactQueryParams,
          hasCallback: Boolean(privacyOptions.redact),
        },
        limits,
      })
    );

    // Closed after the manifest, because the closing link reports the outcome
    // the manifest settled on, and the control diffs are read back out of the
    // finished bundle rather than kept in memory for the length of a run.
    if (linksSink) {
      await linksSink.close({ manifest, bundlePath: bundle.root });
    }
    if (network?.har) {
      await writeHar(
        await readTrace(bundle.root),
        typeof network.har === 'string' ? network.har : undefined
      );
    }
    if (options.gzip || limits.gzip) {
      await gzipTrace(bundle.root);
    }

    const result = {
      path: bundle.root,
      manifest,
      checkpoints: [...checkpoints],
      problems: [...bundle.problems, ...(linksSink?.problems ?? [])],
      links: linksSink?.path ?? null,
      ...(bundle.segments?.length ? { segments: bundle.segments } : {}),
    };
    setStopped(result);

    if (discard) {
      const fs = await import('node:fs/promises');
      await fs.rm(bundle.root, { recursive: true, force: true });
      // An export of a bundle that no longer exists points at nothing.
      await linksSink?.discard();
      result.discarded = true;
    }

    return result;
  }

  return (options) => {
    stopping ??= stop(options).catch(async (error) => {
      setStopped(true);
      await abortTraceStart({ ...context, video: null }).catch(() => {});
      throw error;
    });
    return stopping;
  };
}
