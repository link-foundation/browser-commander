import { it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installUserActionRecorderInPage } from '../../../src/traces/user-actions.js';
import { observeCommanderActions } from '../../../src/traces/commander-actions.js';
import { interactionTarget } from '../../../src/traces/observers.js';

function documentFixture(options = {}) {
  const listeners = new Map();
  const window = {
    CSS: { escape: (id) => id },
    getComputedStyle: () => ({ visibility: 'visible' }),
  };
  window.top = window;
  const root = { getElementById: () => null };
  const target = {
    nodeType: 1,
    localName: options.tag ?? 'button',
    id: 'delete',
    type: 'text',
    labels: [],
    value: 'PRIVATE_TYPED_TEXT',
    childNodes: [],
    getRootNode: () => root,
    getClientRects: () => [{}],
    getAttribute: (name) => (name === 'aria-label' ? 'Delete position' : null),
    closest: (selector) =>
      selector === '[data-private]'
        ? options.secret
          ? target
          : null
        : selector === '#other'
          ? null
          : selector === target.localName || selector.includes('button')
            ? target
            : null,
    querySelector: () => null,
  };
  target.childNodes.push({
    nodeType: 3,
    nodeValue: options.text ?? 'Delete',
    parentElement: target,
    getRootNode: () => root,
  });
  const context = vm.createContext({
    window,
    location: { href: 'https://example.test/' },
    document: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name) => listeners.delete(name),
    },
  });
  vm.runInContext(
    `(${installUserActionRecorderInPage.toString()})(${JSON.stringify({
      globalName: 'recorder',
      binding: null,
      maxQueued: 2,
      redactSelectors: ['[data-private]'],
      ignoreSelectors: [],
      redacted: '[redacted]',
    })})`,
    context
  );
  const fire = (type, extras = {}) =>
    listeners.get(type)?.({
      type,
      isTrusted: true,
      target,
      composedPath: () => [target],
      ...extras,
    });
  const evaluate = (fn, argument, element = null) => {
    context.argument = argument;
    context.element = element;
    return vm.runInContext(
      `(${fn.toString()})(...${element ? '[element, argument]' : '[argument]'})`,
      context
    );
  };
  return { window, target, listeners, fire, evaluate, state: window.recorder };
}

it('records only trusted actions and non-text keys, and stops listeners', () => {
  const { fire, state, listeners } = documentFixture();
  fire('click', { isTrusted: false });
  fire('keydown', { key: 'a' });
  fire('keydown', { key: 'Enter', isComposing: true });
  assert.equal(state.queue.length, 0);
  fire('click');
  fire('keydown', { key: 'Escape' });
  assert.equal(state.queue.length, 2);
  assert.equal(state.queue[0].source, 'user');
  assert.equal(state.queue[0].target.name, 'Delete position');
  assert.equal(state.queue[1].key, 'Escape');
  assert.doesNotMatch(JSON.stringify(state.queue), /PRIVATE_TYPED_TEXT/);
  state.stop();
  assert.equal(listeners.size, 0);
});

it('bounds the action queue and redacts private targets before delivery', () => {
  const { fire, state } = documentFixture({
    secret: true,
    text: 'PRIVATE_TARGET',
  });
  for (let i = 0; i < 5; i += 1) {
    fire('click');
  }
  assert.equal(state.queue.length, 2);
  assert.equal(state.dropped, 3);
  assert.doesNotMatch(JSON.stringify(state.queue), /PRIVATE_TARGET/);
  assert.equal(state.queue[0].target.name, '[redacted]');
});

it('never describes typed textarea text and keeps unrelated manual actions during automation', () => {
  const { fire, state, window } = documentFixture({
    tag: 'textarea',
    text: 'PRIVATE_TEXTAREA',
  });
  window.__browserCommanderActions__ = [
    { selector: '#other', types: ['click'] },
  ];
  fire('click');
  assert.equal(state.queue.length, 1);
  assert.equal(state.queue[0].target.text, '');
  assert.doesNotMatch(JSON.stringify(state.queue), /PRIVATE_TEXTAREA/);
});

it('attributes element-handle input to the commander and removes its marker', async () => {
  const { fire, state, evaluate, target, window } = documentFixture();
  const element = {
    evaluate: (fn, argument) => evaluate(fn, argument, target),
  };
  const commander = { clickElement: async () => fire('click') };
  const recorded = [];
  const detach = observeCommanderActions({
    commander,
    page: { evaluate },
    names: ['clickElement'],
    targetOf: interactionTarget,
    now: () => 0,
    record: async (kind, event) => recorded.push({ kind, ...event }),
  });
  try {
    await commander.clickElement({ locatorOrElement: element });
    assert.equal(state.queue.length, 0);
    assert.equal(recorded[0].source, 'commander');
    assert.equal(window.__browserCommanderActions__.length, 0);
  } finally {
    detach();
  }
});
