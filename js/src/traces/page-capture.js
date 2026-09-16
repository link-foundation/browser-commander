/**
 * The part of tracing that runs inside the page (issue #87).
 *
 * These functions are serialized and evaluated in the browser, so they may
 * only use browser globals and their own arguments. They exist because
 * `page.content()` is not a replay: `value`, `checked`, `selected`, focus,
 * scroll offsets and open shadow roots are runtime state that serialized
 * markup does not carry.
 *
 * Redaction happens here, before the bytes ever leave the page.
 */

/** Global the mutation recorder keeps its queue on. */
export const RECORDER_GLOBAL = '__browserCommanderTrace__';

/* c8 ignore start -- these bodies run inside the browser, not under node */

/**
 * Capture full HTML plus live control state from one document.
 *
 * Runs in the page. Redaction is applied to a clone, so the live page a
 * caller is still automating is never modified by being traced.
 *
 * @param {Object} options - `{redactSelectors, redactAttributes, redacted, html, liveControlState, openShadowRoots, maxHtmlBytes}`
 * @returns {Object} `{html, state, url, title, frames, truncated}`
 */
export function captureSnapshotInPage(options) {
  const {
    redactSelectors = [],
    redactAttributes = [],
    redacted = '[redacted]',
    html: wantHtml = true,
    liveControlState = true,
    openShadowRoots = true,
    maxHtmlBytes = 0,
  } = options || {};

  const isSecret = (element) =>
    redactSelectors.some((selector) => {
      try {
        return element.matches(selector);
      } catch {
        return false;
      }
    });

  const cssPath = (element) => {
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 10) {
      let part = node.localName;
      if (node.id) {
        parts.unshift(`#${node.id}`);
        break;
      }
      const parent = node.parentNode;
      if (parent && parent.children) {
        const siblings = [...parent.children].filter(
          (child) => child.localName === node.localName
        );
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node =
        node.parentNode && node.parentNode.host ? node.parentNode.host : parent;
    }
    return parts.join(' > ');
  };

  const controls = [];
  const collectControls = (root) => {
    const found = root.querySelectorAll
      ? root.querySelectorAll('input, textarea, select, [contenteditable]')
      : [];
    for (const element of found) {
      const secret = isSecret(element);
      const entry = {
        path: cssPath(element),
        tag: element.localName,
        type: element.type || null,
        name: element.name || null,
        id: element.id || null,
        focused: element === document.activeElement,
      };
      if (element.localName === 'select') {
        entry.value = secret ? redacted : element.value;
        entry.selected = [...element.selectedOptions].map((option) =>
          secret ? redacted : option.value
        );
      } else if (element.type === 'checkbox' || element.type === 'radio') {
        entry.checked = element.checked;
        entry.value = secret ? redacted : element.value;
      } else if (element.isContentEditable) {
        entry.value = secret ? redacted : element.textContent;
      } else {
        entry.value = secret ? redacted : element.value;
      }
      if (element.scrollTop || element.scrollLeft) {
        entry.scroll = { top: element.scrollTop, left: element.scrollLeft };
      }
      entry.redacted = secret;
      controls.push(entry);
    }
    if (openShadowRoots && root.querySelectorAll) {
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) {
          collectControls(element.shadowRoot);
        }
      }
    }
  };

  if (liveControlState) {
    collectControls(document);
  }

  // The clone carries the *live* state into the markup: a serialized
  // `<input>` otherwise shows the value the server sent, not the one the user
  // typed.
  const carryLiveState = (original, copy, secret) => {
    for (const attribute of redactAttributes) {
      if (copy.hasAttribute && copy.hasAttribute(attribute)) {
        copy.setAttribute(attribute, redacted);
      }
    }
    if (original.localName === 'input' || original.localName === 'textarea') {
      const value = secret ? redacted : original.value;
      copy.setAttribute('value', value);
      if (original.localName === 'textarea') {
        copy.textContent = value;
      }
      if (original.type === 'checkbox' || original.type === 'radio') {
        if (original.checked) {
          copy.setAttribute('checked', '');
        } else {
          copy.removeAttribute('checked');
        }
      }
    } else if (original.localName === 'option') {
      if (original.selected) {
        copy.setAttribute('selected', '');
      } else {
        copy.removeAttribute('selected');
      }
    } else if (secret) {
      copy.textContent = redacted;
    }
    if (original.shadowRoot && openShadowRoots) {
      // Shadow content is not serialized by `outerHTML`; a declarative
      // template keeps it in the same document the viewer renders.
      const template = document.createElement('template');
      template.setAttribute('shadowrootmode', 'open');
      template.innerHTML = original.shadowRoot.innerHTML;
      copy.appendChild(template);
    }
  };

  let html = null;
  let truncated = false;
  if (wantHtml) {
    const clone = document.documentElement.cloneNode(true);
    const originals = document.documentElement.querySelectorAll('*');
    const copies = clone.querySelectorAll('*');
    for (let index = 0; index < originals.length; index++) {
      const copy = copies[index];
      if (!copy) {
        break;
      }
      carryLiveState(originals[index], copy, isSecret(originals[index]));
    }

    html = `<!DOCTYPE html>\n${clone.outerHTML}`;
    if (maxHtmlBytes > 0 && html.length > maxHtmlBytes) {
      html = html.slice(0, maxHtmlBytes);
      truncated = true;
    }
  }

  return {
    html,
    state: {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      scroll: { x: window.scrollX, y: window.scrollY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      activeElement: document.activeElement
        ? cssPath(document.activeElement)
        : null,
      controls,
      frames: [...document.querySelectorAll('iframe, frame')].map((frame) => ({
        path: cssPath(frame),
        src: frame.getAttribute('src'),
        name: frame.getAttribute('name'),
      })),
    },
    truncated,
  };
}

/**
 * Install the in-page recorder.
 *
 * Reinstalling after a navigation is safe and expected: the queue lives on the
 * document, which a navigation replaces. Issue #93 is why this also runs as an
 * init script - installing it only from `checkpoint()` left the interval
 * between a navigation and the next checkpoint unrecorded, so a page that
 * built its first screen during `DOMContentLoaded` replayed as if it had
 * always been there.
 *
 * Two kinds of change are recorded. DOM mutations come from a
 * `MutationObserver`, with the position information a deterministic replay
 * needs. Live control state - what was typed, checked, selected, focused and
 * scrolled - produces no mutation records at all, so it is observed from the
 * events that carry it and recorded on the same queue, in the same order.
 *
 * @param {Object} options - `{globalName, redactSelectors, redacted, maxQueued, liveState}`
 * @returns {boolean} True when a recorder is now observing
 */
export function installMutationRecorderInPage(options) {
  const {
    globalName = '__browserCommanderTrace__',
    redactSelectors = [],
    redacted = '[redacted]',
    maxQueued = 5000,
    liveState = true,
  } = options || {};

  if (window[globalName] && window[globalName].observing) {
    return true;
  }

  const state = {
    observing: true,
    queue: [],
    dropped: 0,
    sequence: 0,
    // Every document gets its own name, so a batch drained from an iframe is
    // never mistaken for one drained from the page that holds it.
    frameId: `frame-${Math.random().toString(36).slice(2, 10)}`,
    frameName: window.name || null,
    mainFrame: window.top === window,
  };

  const isSecret = (node) => {
    const element =
      node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!element || !element.matches) {
      return false;
    }
    return redactSelectors.some((selector) => {
      try {
        return element.matches(selector) || element.closest(selector) !== null;
      } catch {
        return false;
      }
    });
  };

  // A path the viewer can look the node up by: replay needs to find the same
  // element again in a parsed copy of the checkpoint.
  const pathOf = (node) => {
    const steps = [];
    for (let at = node; at && at.nodeType === 1; at = at.parentElement) {
      if (at.id) {
        steps.unshift(`#${at.id}`);
        break;
      }
      const siblings = at.parentElement
        ? [...at.parentElement.children].filter(
            (c) => c.localName === at.localName
          )
        : [];
      const nth =
        siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(at) + 1})` : '';
      steps.unshift(at.localName + nth);
    }
    return steps.join(' > ');
  };

  const childIndexOf = (parent, node) => {
    if (!parent || !node || !parent.childNodes) {
      return -1;
    }
    return Array.prototype.indexOf.call(parent.childNodes, node);
  };

  const describe = (node) => {
    if (!node) {
      return null;
    }
    if (node.nodeType === 3) {
      return {
        type: 'text',
        path: pathOf(node.parentElement),
        text: isSecret(node) ? redacted : String(node.nodeValue).slice(0, 2000),
      };
    }
    if (node.nodeType !== 1) {
      return { type: 'node', nodeType: node.nodeType };
    }
    return {
      type: 'element',
      tag: node.localName,
      id: node.id || null,
      path: pathOf(node),
      html: isSecret(node) ? redacted : String(node.outerHTML).slice(0, 4000),
    };
  };

  /**
   * Describe a node that is no longer where it was.
   *
   * A removed node has no `parentElement`, so `pathOf` can only name the node
   * itself. Its position in the parent it left is what a replay needs, and
   * that is read from the siblings the record still points at.
   *
   * @param {Node} node - The node that moved or was removed
   * @param {MutationRecord} record - The record it came from
   * @returns {Object|null} The description, with `index` when one is knowable
   */
  const describeAt = (node, record) => {
    const described = describe(node);
    if (!described) {
      return null;
    }
    const parent = record.target;
    const own = childIndexOf(parent, node);
    if (own >= 0) {
      described.index = own;
      return described;
    }
    const after = childIndexOf(parent, record.previousSibling);
    if (after >= 0) {
      described.index = after + 1;
      return described;
    }
    const before = childIndexOf(parent, record.nextSibling);
    described.index = before >= 0 ? before : null;
    return described;
  };

  const push = (batch) => {
    if (state.queue.length >= maxQueued) {
      state.dropped += 1;
      return false;
    }
    state.queue.push({
      sequence: ++state.sequence,
      at: Date.now(),
      url: location.href,
      frameId: state.frameId,
      mainFrame: state.mainFrame,
      ...batch,
    });
    return true;
  };

  const observer = new MutationObserver((records) => {
    if (state.queue.length >= maxQueued) {
      state.dropped += records.length;
      return;
    }
    push({
      records: records.map((record) => {
        const entry = {
          kind: record.type,
          target: describe(record.target),
        };
        if (record.type === 'attributes') {
          entry.attribute = record.attributeName;
          const secret =
            isSecret(record.target) ||
            redactSelectors.includes(record.attributeName);
          entry.before = secret ? redacted : record.oldValue;
          entry.after =
            secret || !record.target.getAttribute
              ? redacted
              : record.target.getAttribute(record.attributeName);
        } else if (record.type === 'characterData') {
          entry.before = isSecret(record.target) ? redacted : record.oldValue;
          entry.after = isSecret(record.target)
            ? redacted
            : record.target.nodeValue;
        } else {
          // Where a node went is as much of the change as what it was:
          // appending every addition to the end replays an insertion before a
          // sibling in the wrong place, and drops moves and removals entirely.
          entry.added = [...record.addedNodes].map((node) =>
            describeAt(node, record)
          );
          entry.removed = [...record.removedNodes].map((node) =>
            describeAt(node, record)
          );
          entry.previous = describe(record.previousSibling);
          entry.next = describe(record.nextSibling);
        }
        return entry;
      }),
    });
  });

  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    characterData: true,
    characterDataOldValue: true,
  });

  const liveDetachers = [];
  if (liveState) {
    const lastValues = new WeakMap();

    const liveEntry = (target, property, after, before) => ({
      kind: 'live-state',
      property,
      target: describe(target),
      before: before === undefined ? null : before,
      after,
    });

    const pushLive = (entry) => {
      // Scrolling fires far more often than it changes anything worth
      // replaying, so consecutive scrolls of one element collapse into the
      // position it ended at. Every other property keeps each step, because
      // "stepwise replay must show each state" (issue #93).
      const last = state.queue[state.queue.length - 1];
      const only = last && last.records.length === 1 ? last.records[0] : null;
      if (
        entry.property === 'scroll' &&
        only &&
        only.kind === 'live-state' &&
        only.property === 'scroll' &&
        only.target?.path === entry.target?.path
      ) {
        only.after = entry.after;
        last.at = Date.now();
        return;
      }
      push({ records: [entry] });
    };

    const valueOf = (element) =>
      isSecret(element)
        ? redacted
        : element.isContentEditable
          ? element.textContent
          : element.value;

    const onValue = (event) => {
      const element = event.target;
      if (!element || element.nodeType !== 1) {
        return;
      }
      if (element.type === 'checkbox' || element.type === 'radio') {
        pushLive(liveEntry(element, 'checked', element.checked));
        return;
      }
      if (element.localName === 'select') {
        pushLive(
          liveEntry(
            element,
            'selected',
            [...element.selectedOptions].map((option) =>
              isSecret(element) ? redacted : option.value
            )
          )
        );
        return;
      }
      if (
        element.localName !== 'input' &&
        element.localName !== 'textarea' &&
        !element.isContentEditable
      ) {
        return;
      }
      const after = valueOf(element);
      const before = lastValues.get(element);
      lastValues.set(element, after);
      pushLive(liveEntry(element, 'value', after, before));
    };

    const onFocus = (event) => {
      pushLive(liveEntry(event.target, 'focus', event.type === 'focusin'));
    };

    const onScroll = (event) => {
      const target = event.target;
      const scrolling =
        target === document || target === document.documentElement || !target
          ? null
          : target;
      pushLive({
        kind: 'live-state',
        property: 'scroll',
        target: scrolling ? describe(scrolling) : null,
        before: null,
        after: scrolling
          ? { top: scrolling.scrollTop, left: scrolling.scrollLeft }
          : { top: window.scrollY, left: window.scrollX },
      });
    };

    const listen = (type, handler) => {
      document.addEventListener(type, handler, true);
      liveDetachers.push(() =>
        document.removeEventListener(type, handler, true)
      );
    };

    listen('input', onValue);
    listen('change', onValue);
    listen('focusin', onFocus);
    listen('focusout', onFocus);
    listen('scroll', onScroll);
  }

  state.stop = () => {
    observer.disconnect();
    for (const detach of liveDetachers) {
      detach();
    }
    state.observing = false;
  };

  window[globalName] = state;
  return true;
}

/**
 * Take everything the recorder has queued and leave the queue empty.
 *
 * @param {string} globalName - Global the recorder lives on
 * @returns {Object} `{batches, dropped, installed, frameId, mainFrame}`
 */
export function drainMutationsInPage(globalName) {
  const state = window[globalName || '__browserCommanderTrace__'];
  if (!state) {
    return {
      batches: [],
      dropped: 0,
      installed: false,
      frameId: null,
      mainFrame: window.top === window,
      url: location.href,
    };
  }
  const batches = state.queue;
  const dropped = state.dropped;
  state.queue = [];
  state.dropped = 0;
  return {
    batches,
    dropped,
    installed: true,
    frameId: state.frameId,
    mainFrame: state.mainFrame,
    url: location.href,
  };
}

/**
 * Stop the in-page recorder without waiting for the document to go away.
 *
 * @param {string} globalName - Global the recorder lives on
 * @returns {boolean} True when a recorder was stopped
 */
export function stopMutationRecorderInPage(globalName) {
  const state = window[globalName || '__browserCommanderTrace__'];
  if (!state || !state.observing) {
    return false;
  }
  state.stop();
  return true;
}

/* c8 ignore stop */
