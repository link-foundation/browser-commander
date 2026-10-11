import { withDeadline } from './deadline.js';
import { framesOf, installInitScript } from './init-script.js';
import { TRACE_EVENT, TRACE_DROP_REASON } from './schema.js';

const bindings = new WeakMap();
const USER_ACTION_BINDING = '__browserCommanderUserActionsEmit__';

async function attachBinding(page, route, emit) {
  if (!page.exposeFunction) {
    return null;
  }
  let binding = bindings.get(page);
  if (!binding) {
    const callbacks = new Map();
    binding = {
      callbacks,
      ready: page.exposeFunction(USER_ACTION_BINDING, (id, payload) =>
        callbacks.get(id)?.(payload)
      ),
    };
    bindings.set(page, binding);
  }
  await binding.ready;
  binding.callbacks.set(route, emit);
  return () => binding.callbacks.delete(route);
}

/** Runs in each document. Event descriptions never read control values. */
export function installUserActionRecorderInPage(options) {
  const {
    globalName,
    binding,
    maxQueued,
    redactSelectors,
    ignoreSelectors,
    redacted,
  } = options;
  if (window[globalName]?.observing) {
    return;
  }
  const state = {
    observing: true,
    queue: [],
    dropped: 0,
    frameId: `frame-${Math.random().toString(36).slice(2, 10)}`,
  };
  const matches = (node, selectors) => {
    for (let at = node; at; at = at.getRootNode?.()?.host) {
      if (
        selectors.some((selector) => {
          try {
            return Boolean(at.closest?.(selector));
          } catch {
            return false;
          }
        })
      ) {
        return true;
      }
    }
    return false;
  };
  const privateNode = (node) => matches(node, redactSelectors);
  const pathOf = (node) => {
    const steps = [];
    let separator = '';
    for (let at = node; at?.nodeType === 1 && steps.length < 20;) {
      const siblings = [...(at.parentElement?.children ?? [])].filter(
        (child) => child.localName === at.localName
      );
      const step = at.id
        ? `#${window.CSS.escape(at.id)}`
        : `${at.localName}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(at) + 1})` : ''}`;
      steps.unshift(`${step}${separator}`);
      if (at.id) {
        break;
      }
      separator = at.parentElement ? ' > ' : ' >>> ';
      at = at.parentElement ?? at.getRootNode()?.host;
    }
    return steps.join('');
  };
  const visibleText = (node, depth = 0, budget = { remaining: 500 }) => {
    if (
      !node ||
      depth >= 20 ||
      --budget.remaining < 0 ||
      matches(node.nodeType === 1 ? node : node.parentElement, [
        'input',
        'textarea',
        'select',
        '[contenteditable]',
        ...ignoreSelectors,
      ])
    ) {
      return '';
    }
    if (privateNode(node.nodeType === 1 ? node : node.parentElement)) {
      return redacted;
    }
    if (node.nodeType === 3) {
      return node.nodeValue ?? '';
    }
    if (
      node.nodeType === 1 &&
      (!node.getClientRects().length ||
        window.getComputedStyle(node).visibility === 'hidden')
    ) {
      return '';
    }
    let text = '';
    for (const child of node.childNodes ?? []) {
      text += visibleText(child, depth + 1, budget);
      if (text.length >= 500) {
        break;
      }
    }
    return text.slice(0, 500);
  };
  const describe = (target) => {
    const secret = privateNode(target);
    const text = secret ? redacted : visibleText(target).trim();
    const labelled = (target.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => visibleText(target.getRootNode().getElementById?.(id)))
      .join(' ')
      .trim();
    const label = [...(target.labels ?? [])]
      .slice(0, 20)
      .map((node) => visibleText(node))
      .join(' ')
      .trim();
    const roles = {
      button: 'button',
      a: 'link',
      textarea: 'textbox',
      select: 'combobox',
      form: 'form',
    };
    const inputRole =
      target.type === 'checkbox'
        ? 'checkbox'
        : target.type === 'radio'
          ? 'radio'
          : ['submit', 'button', 'reset'].includes(target.type)
            ? 'button'
            : 'textbox';
    return {
      path: pathOf(target),
      role:
        target.getAttribute('role') ??
        (target.localName === 'input'
          ? inputRole
          : (roles[target.localName] ?? null)),
      name: secret
        ? redacted
        : (
            labelled ||
            target.getAttribute('aria-label') ||
            label ||
            target.getAttribute('alt') ||
            target.getAttribute('title') ||
            text
          ).slice(0, 500),
      text,
    };
  };
  const nonTextKeys =
    /^(?:Enter|Escape|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1\d|2[0-4]))$/;
  const listener = (event) => {
    if (
      !event.isTrusted ||
      (event.type === 'keydown' &&
        (!nonTextKeys.test(event.key) || event.isComposing))
    ) {
      return;
    }
    const nodes = event.composedPath?.() ?? [event.target];
    let target = nodes.find((node) => node?.nodeType === 1);
    if (!target || matches(target, ignoreSelectors)) {
      return;
    }
    // Only suppress engine input aimed at the commander's current target.
    // A person using another control while an automation call waits is still
    // recorded. Trusted input outside commander methods is always user input.
    const commanderInput = (window.__browserCommanderActions__ ?? []).some(
      (action) => {
        if (!action.types.includes(event.type)) {
          return false;
        }
        if (action.element) {
          return (
            action.element === target ||
            action.element.contains(target) ||
            (event.type === 'click' &&
              event.detail === 0 &&
              action.types.includes('keydown') &&
              action.element.form &&
              action.element.form === target.form) ||
            (event.type === 'submit' && target.contains(action.element))
          );
        }
        if (!action.selector) {
          return event.type === 'keydown';
        }
        try {
          return (
            Boolean(target.closest(action.selector)) ||
            (event.type === 'submit' &&
              Boolean(target.querySelector(action.selector)))
          );
        } catch {
          return false;
        }
      }
    );
    if (commanderInput) {
      return;
    }
    if (event.type !== 'keydown') {
      target =
        target.closest(
          'button, a, input, select, textarea, form, [role], [contenteditable]'
        ) ?? target;
    }
    const payload = {
      source: 'user',
      actor: 'user',
      action: event.type,
      target: describe(target),
      at: new Date().toISOString(),
      url: location.href,
      frameId: state.frameId,
      mainFrame: window.top === window,
      ...(event.type === 'keydown'
        ? {
            key: event.key,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
          }
        : {}),
    };
    const enqueue = () => {
      if (!state.observing) {
        return;
      }
      if (state.queue.length < maxQueued) {
        state.queue.push(payload);
      } else {
        state.dropped += 1;
      }
    };
    if (binding && typeof window[binding] === 'function') {
      // Bindings deliver the action before the app's request/response callbacks;
      // engines without bindings use the bounded polling queue instead.
      Promise.resolve(window[binding](globalName, payload)).catch(enqueue);
    } else {
      enqueue();
    }
  };
  const types = ['click', 'pointerdown', 'keydown', 'submit', 'contextmenu'];
  for (const type of types) {
    document.addEventListener(type, listener, true);
  }
  state.stop = () => {
    state.observing = false;
    for (const type of types) {
      document.removeEventListener(type, listener, true);
    }
  };
  window[globalName] = state;
}

function drainUserActionsInPage(globalName) {
  const state = window[globalName];
  if (!state) {
    return { actions: [], dropped: 0 };
  }
  const result = { actions: state.queue.splice(0), dropped: state.dropped };
  state.dropped = 0;
  return result;
}

function stopUserActionsInPage(globalName) {
  window[globalName]?.stop();
}

/** Host half, shared by raw launched pages and commander traces. */
export function createUserActionStream(options) {
  const {
    page,
    enabled,
    record,
    identity,
    note,
    privacyOptions,
    limits,
    evaluateInPage,
    captureTimeoutMs,
  } = options;
  const globalName = `__browserCommanderUserActions_${identity.traceId}`;
  let active = true,
    detachInit,
    detachBinding;
  const pending = new Set();
  const emit = (payload) => {
    if (!active) {
      return Promise.resolve();
    }
    if (pending.size >= (limits.maxQueuedUserActions ?? 5000)) {
      return Promise.reject(new Error('user action writer busy'));
    }
    const promise = record(TRACE_EVENT.INTERACTION, {
      ...payload,
      actionId: identity.nextActionId(),
    });
    pending.add(promise);
    promise.finally(() => pending.delete(promise)).catch(() => {});
    return promise;
  };
  const evaluate = async (fn, arg) => {
    const frames = framesOf(page);
    return await withDeadline(
      frames.length
        ? Promise.all(
            frames.map((frame) => frame.evaluate(fn, arg).catch(() => null))
          )
        : Promise.resolve(evaluateInPage(fn, arg)).then((result) => [result]),
      captureTimeoutMs,
      'trace user actions'
    );
  };
  async function install() {
    if (!enabled) {
      return;
    }
    try {
      detachBinding = await attachBinding(page, globalName, emit).catch(
        (error) => {
          note(`using queued user actions: ${error.message}`);
          return null;
        }
      );
      const config = {
        globalName,
        binding: detachBinding ? USER_ACTION_BINDING : null,
        maxQueued: limits.maxQueuedUserActions ?? 5000,
        redactSelectors: privacyOptions.redactSelectors,
        ignoreSelectors: options.ignoreSelectors ?? [],
        redacted: '[redacted]',
      };
      detachInit = await installInitScript({
        page,
        fn: installUserActionRecorderInPage,
        arg: config,
        note,
      });
      await evaluate(installUserActionRecorderInPage, config);
    } catch (error) {
      note(`could not install user action recorder: ${error.message}`);
      await record(TRACE_EVENT.DROPPED, {
        reason: TRACE_DROP_REASON.CAPTURE_FAILED,
        member: 'user-actions',
        detail: error.message,
      });
    }
  }
  async function drain() {
    if (!enabled) {
      return;
    }
    try {
      for (const result of await evaluate(drainUserActionsInPage, globalName)) {
        for (const action of result?.actions ?? []) {
          await emit(action);
        }
        if (result?.dropped) {
          await record(TRACE_EVENT.DROPPED, {
            reason: TRACE_DROP_REASON.SIZE_LIMIT,
            member: 'user-actions',
            detail: `${result.dropped} user actions over the queue limit`,
          });
        }
      }
      await Promise.all([...pending]);
    } catch (error) {
      note(`could not drain user actions: ${error.message}`);
    }
  }
  async function stop() {
    active = false;
    await evaluate(stopUserActionsInPage, globalName).catch((error) =>
      note(error.message)
    );
    try {
      await detachInit?.();
    } finally {
      detachBinding?.();
    }
  }
  return { install, drain, stop };
}
