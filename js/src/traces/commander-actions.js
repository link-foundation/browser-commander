/** One wrapper per commander, even when explicit and automatic traces overlap. */
import { withDeadline } from './deadline.js';
import { framesOf } from './init-script.js';

const commanders = new WeakMap();

let actionSequence = 0;

function labelActionInPage(argument, elementOptions) {
  const { marker, remove } = elementOptions ?? argument;
  const actions = (window.__browserCommanderActions__ ??= []);
  if (remove) {
    const index = actions.findIndex((action) => action.id === marker.id);
    if (index >= 0) {
      actions.splice(index, 1);
    }
  } else {
    const focused =
      !marker.selector && marker.types.includes('keydown')
        ? document.activeElement
        : null;
    actions.push({
      ...marker,
      element: elementOptions
        ? argument
        : focused !== document.body && focused !== document.documentElement
          ? focused
          : null,
    });
  }
}

export function observeCommanderActions({
  commander,
  page,
  names,
  targetOf,
  record,
  identity,
  now,
  note,
}) {
  if (!commander) {
    return () => {};
  }
  let state = commanders.get(commander);
  if (!state) {
    state = { observers: new Set(), originals: new Map() };
    commanders.set(commander, state);
    for (const name of names) {
      const original = commander[name];
      if (typeof original !== 'function') {
        continue;
      }
      const wrapper = async (...args) => {
        await commander.ready;
        const observing = [...state.observers].map((observer) => ({
          observer,
          started: observer.now(),
          actionId: observer.identity?.nextActionId() ?? null,
        }));
        const marker = {
          id: ++actionSequence,
          selector: targetOf(args[0]),
          types: /^(click|check)/.test(name)
            ? ['pointerdown', 'click', 'submit', 'contextmenu']
            : /^(fill|typeText|pressKey)/.test(name)
              ? ['keydown', 'submit', 'click']
              : [],
        };
        const element = args[0]?.locatorOrElement ?? args[0]?.selector;
        const labelAction = async (remove) => {
          try {
            if (marker.types.length) {
              const config = { marker, remove };
              const frames =
                remove || (!marker.selector && marker.types.includes('keydown'))
                  ? framesOf(page)
                  : [];
              const target = element?.first?.() ?? element;
              const work = frames.length
                ? Promise.all(
                    frames.map((frame) =>
                      frame.evaluate(labelActionInPage, config)
                    )
                  )
                : !remove && typeof target?.evaluate === 'function'
                  ? target.evaluate(labelActionInPage, config, {
                      timeout: 1000,
                    })
                  : page.evaluate?.(labelActionInPage, config);
              await withDeadline(
                Promise.resolve(work),
                1000,
                'commander input label'
              );
            }
          } catch (error) {
            note?.(`could not label commander input: ${error.message}`);
          }
        };
        await labelAction(false);
        let error;
        try {
          return await original.apply(commander, args);
        } catch (failure) {
          error = failure;
          throw failure;
        } finally {
          await labelAction(true);
          await Promise.all(
            observing.map(({ observer, started, actionId }) =>
              observer.record('interaction', {
                actionId,
                source: 'commander',
                action: name,
                target: targetOf(args[0]),
                durationMs: observer.now() - started,
                ok: !error,
                ...(error ? { error: error.message } : {}),
              })
            )
          );
        }
      };
      state.originals.set(name, { original, wrapper });
      commander[name] = wrapper;
    }
  }
  const observer = { record, identity, now };
  if (record) {
    state.observers.add(observer);
  }
  return () => {
    state.observers.delete(observer);
    if (state.observers.size) {
      return;
    }
    for (const [name, { original, wrapper }] of state.originals) {
      if (commander[name] === wrapper) {
        commander[name] = original;
      }
    }
    // A repeated teardown may belong to an older, already stopped recording.
    // Preserve observers installed by a newer explicit trace on this commander.
    if (commanders.get(commander) === state) {
      commanders.delete(commander);
    }
  };
}
