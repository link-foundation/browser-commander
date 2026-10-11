import { startTrace } from '../traces/recorder.js';
import { debugEnabled, ensureDebugSession } from '../traces/debug-session.js';
import { observeCommanderActions } from '../traces/commander-actions.js';
import { TRACED_INTERACTIONS, interactionTarget } from '../traces/observers.js';
import { touchSessionPage } from '../browser/persistent-session.js';
import { dismissOverlays } from '../interactions/overlays.js';
import {
  screenshot,
  startRecording,
  encodeAnimation,
} from '../capture/index.js';

const INTERACTIONS = new Set([
  'clickButton',
  'clickElement',
  'fillTextArea',
  'check',
  'pressKey',
]);

/** Bind capture, persistence and automatic debugging to the commander lifecycle. */
export function attachCommanderFeatures(commander, options, recreate) {
  const { page, engine } = commander;
  const managed = new Set();
  function track(item) {
    const stop = item.stop.bind(item);
    let stopping;
    item.stop = (...args) => {
      stopping ??= Promise.resolve()
        .then(() => stop(...args))
        .finally(() => managed.delete(item));
      return stopping;
    };
    managed.add(item);
    return item;
  }
  commander.screenshot = (captureOptions = {}) =>
    screenshot({ ...options.capture, ...captureOptions, page, engine });
  commander.startRecording = async (recordingOptions = {}) =>
    track(await startRecording({ ...recordingOptions, page, engine }));
  commander.gif = (frames, animationOptions = {}) =>
    encodeAnimation(frames, { ...animationOptions, format: 'gif' });
  commander.dismissOverlays = (overlays = options.overlays) =>
    dismissOverlays({
      page,
      engine,
      overlays,
      onDismiss: options.onOverlayDismiss,
    });
  commander.startTrace = async (traceOptions = {}) =>
    track(await startTrace({ commander, page, ...traceOptions }));
  let debugSession;
  let detachActions;
  commander.tracePath = null;
  const ensureDebug = () => commander.ready;
  for (const name of [...INTERACTIONS, 'goto', 'evaluate', 'count']) {
    const method = commander[name];
    if (!method) {
      continue;
    }
    commander[name] = async (...args) => {
      touchSessionPage(page);
      await ensureDebug();
      if (INTERACTIONS.has(name)) {
        await commander.dismissOverlays();
      }
      return method(...args);
    };
  }
  const destroy = commander.destroy;
  commander.destroy = async () => {
    try {
      await commander.ready;
      await debugSession?.stop();
      await Promise.all([...managed].map((item) => item.stop()));
      detachActions?.();
    } finally {
      await destroy();
    }
  };
  commander.reusePage = async (selection = {}) => {
    if (!options.session?.reusePage) {
      throw new Error('reusePage requires a persistent session');
    }
    const selected = await options.session.reusePage(selection);
    if (selected !== page) {
      await commander.destroy();
      Object.assign(
        commander,
        recreate({ ...options, page: selected, downloads: null })
      );
    }
    touchSessionPage(selected);
    return selected;
  };
  if (debugEnabled({ ...options, page })) {
    detachActions = observeCommanderActions({
      commander,
      page,
      names: TRACED_INTERACTIONS,
      targetOf: interactionTarget,
    });
  }
  commander.ready = ensureDebugSession({
    ...options,
    page,
    engine,
    commander,
  }).then((session) => {
    debugSession = session;
    commander.tracePath = session?.path ?? null;
  });
}
