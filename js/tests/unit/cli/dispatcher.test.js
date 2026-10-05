import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  METHOD_NAMES,
  createDispatcher,
  substituteSession,
} from '../../../src/cli/dispatcher.js';
import { importOptional } from '../../../src/cli/modules.js';
import { createFakeDependencies } from '../../helpers/cli-fakes.js';

function setup(overrides = {}) {
  const fakes = createFakeDependencies();
  const notifications = [];
  const dispatcher = createDispatcher({
    dependencies: { ...fakes.dependencies, ...overrides },
    notify: (method, params) => notifications.push({ method, params }),
  });
  return { ...fakes, dispatcher, notifications };
}

describe('dispatcher: high-level methods', () => {
  it('answers every method of the contract', () => {
    for (const method of [
      'session.launch',
      'session.connect',
      'session.close',
      'page.goto',
      'page.click',
      'page.fill',
      'page.eval',
      'page.screenshot',
      'page.pdf',
      'trace.start',
      'trace.stop',
      'cookies.import',
      'profile.migrate',
      'profile.snapshot',
      'attach',
      'attach.tabs',
      'attach.send',
      'attach.close',
      'open',
      'doctor',
      'version',
      'handle.root',
      'handle.call',
      'handle.get',
      'handle.dispose',
      'handle.describe',
      'events.subscribe',
      'events.unsubscribe',
    ]) {
      assert.ok(METHOD_NAMES.includes(method), method);
    }
  });

  it('launches, drives and closes a session', async () => {
    const { dispatcher, launches, pages } = setup();
    const { dispatch } = dispatcher;

    const launched = await dispatch('session.launch', {
      headless: true,
      browser: 'edge',
      restrictions: ['no-extensions'],
    });
    assert.deepEqual(launched, {
      session: 's1',
      cdpEndpoint: 'http://127.0.0.1:9222',
      remoteDebuggingPort: 9222,
      userDataDir: '/tmp/fake-profile',
      temporaryProfile: true,
    });
    assert.deepEqual(launches[0].options, {
      engine: 'playwright',
      headless: true,
      channel: 'msedge',
      restrictions: ['no-extensions'],
    });

    assert.deepEqual(
      await dispatch('page.goto', { session: 's1', url: 'https://a.test/' }),
      { url: 'https://a.test/', title: 'Title of https://a.test/' }
    );
    assert.deepEqual(
      await dispatch('page.fill', { session: 's1', selector: '#q', value: 7 }),
      { filled: '#q', value: '7' }
    );
    assert.deepEqual(
      await dispatch('page.click', { session: 's1', selector: '#go' }),
      { clicked: '#go' }
    );
    assert.deepEqual(
      await dispatch('page.eval', { session: 's1', expression: '1+1' }),
      { value: { expression: '1+1' } }
    );
    assert.deepEqual(await dispatch('page.screenshot', { session: 's1' }), {
      data: { $binary: Buffer.from('png-bytes').toString('base64') },
    });
    const pdf = await dispatch('page.pdf', { session: 's1', path: 'out.pdf' });
    assert.equal(pdf.bytes, 4);
    assert.ok(pdf.path.endsWith('out.pdf'));
    assert.deepEqual(pages[0].calls.at(-1), ['pdf', { path: pdf.path }]);

    assert.deepEqual(await dispatch('session.close', { session: 's1' }), {
      closed: true,
    });
    assert.equal(launches[0].closed, true);
    await assert.rejects(
      dispatch('page.goto', { session: 's1', url: 'x' }),
      /Unknown session: s1/u
    );
  });

  it('fills through a locator for Puppeteer', async () => {
    const { dispatcher, pages } = setup();
    await dispatcher.dispatch('session.launch', { engine: 'puppeteer' });

    await dispatcher.dispatch('page.fill', { selector: '#q', value: 'v' });

    assert.deepEqual(pages[0].calls, [['fill', '#q', 'v']]);
  });

  it('connects without closing the browser', async () => {
    const { dispatcher, connections } = setup();

    const connected = await dispatcher.dispatch('session.connect', {
      cdpEndpoint: 'http://127.0.0.1:9333',
      engine: 'puppeteer',
    });
    await dispatcher.dispatch('session.close', { session: connected.session });

    assert.deepEqual(connected, {
      session: 's1',
      cdpEndpoint: 'http://127.0.0.1:9333',
    });
    assert.equal(connections[0].disconnected, true);
    assert.equal(connections[0].closed, false);
  });

  it('records and stops a trace', async () => {
    const { dispatcher } = setup();
    await dispatcher.dispatch('session.launch', {});

    const started = await dispatcher.dispatch('trace.start', {
      out: '/tmp/bc-trace',
    });
    await assert.rejects(
      dispatcher.dispatch('trace.start', { out: '/tmp/bc-trace' }),
      /already recording/u
    );
    assert.deepEqual(await dispatcher.dispatch('trace.stop', {}), started);
    await assert.rejects(dispatcher.dispatch('trace.stop', {}), {
      code: -32602,
    });
  });

  it('imports cookies and reports the ones the engine rejects', async () => {
    const { dispatcher } = setup();
    await dispatcher.dispatch('session.launch', {});

    const result = await dispatcher.dispatch('cookies.import', {
      from: 'chrome',
      domains: ['a.test', 'b.test'],
    });

    assert.equal(result.imported, 2);
    assert.deepEqual(
      result.skipped.map((entry) => entry.item),
      ['.a.test bad', '.b.test bad']
    );
  });

  it('forwards open, profile.migrate, doctor and version', async () => {
    const { dispatcher } = setup();
    const { dispatch } = dispatcher;

    assert.deepEqual(await dispatch('open', { url: 'https://a.test' }), {
      opened: 'https://a.test',
      command: ['open', 'https://a.test'],
    });
    const migrated = await dispatch('profile.migrate', {
      from: 'chrome',
      include: ['cookies'],
      passwordCsv: '/tmp/export.csv',
    });
    assert.deepEqual(migrated.options.include, ['cookies']);
    assert.equal(migrated.options.passwordCsv, '/tmp/export.csv');
    assert.deepEqual(await dispatch('doctor', {}), { ok: true, unlisted: [] });
    assert.equal((await dispatch('version')).language, 'js');
  });

  it('forwards profile.snapshot and launches with attach', async () => {
    const { dispatcher, launches } = setup();
    const { dispatch } = dispatcher;

    const report = await dispatch('profile.snapshot', {
      from: 'chrome',
      profile: 'Profile 1',
      to: '/tmp/copy',
    });
    assert.equal(report.target, '/tmp/copy');
    assert.equal(report.source.profile, 'Profile 1');
    await assert.rejects(dispatch('profile.snapshot', {}), { code: -32602 });

    await dispatch('session.launch', {
      attach: { mode: 'snapshot', browser: 'chrome' },
    });
    assert.deepEqual(launches[0].options.attach, {
      mode: 'snapshot',
      browser: 'chrome',
    });
  });

  it('keeps an extension relay open until attach.close', async () => {
    const { dispatcher, relays } = setup();
    const { dispatch } = dispatcher;

    await assert.rejects(dispatch('attach', { mode: 'snapshot' }), {
      code: -32602,
    });
    await assert.rejects(dispatch('attach.tabs'), { code: -32602 });
    const attached = await dispatch('attach', { mode: 'extension', port: 0 });
    assert.equal(attached.mode, 'extension');
    assert.equal(attached.extension.id, 'abc');
    assert.equal(attached.tabs[0].tabId, 1);
    assert.equal(attached.differences[0].aspect, 'debugger-infobar');
    assert.equal(relays[0].options.port, 0);
    await assert.rejects(dispatch('attach', { mode: 'extension' }), {
      code: -32602,
    });

    assert.deepEqual(await dispatch('attach.tabs'), attached.tabs);
    assert.deepEqual(
      await dispatch('attach.send', {
        tabId: 1,
        method: 'Runtime.evaluate',
        params: { expression: '1' },
      }),
      { ok: true }
    );
    assert.deepEqual(relays[0].sent, [
      { tabId: 1, method: 'Runtime.evaluate', params: { expression: '1' } },
    ]);
    await assert.rejects(dispatch('attach.send', { tabId: 'x' }), {
      code: -32602,
    });

    assert.equal(relays[0].closed, false);
    assert.deepEqual(await dispatch('attach.close'), { closed: true });
    assert.equal(relays[0].closed, true);
    assert.deepEqual(await dispatch('attach.close'), { closed: false });

    await dispatch('attach', { mode: 'extension' });
    await dispatcher.close();
    assert.equal(relays[1].closed, true);
  });

  it('reports a missing optional module as an engine error', async () => {
    const { dispatcher } = setup({
      openInUserBrowser: () =>
        importOptional('./does-not-exist.js', 'open (openInUserBrowser)'),
    });

    await assert.rejects(
      dispatcher.dispatch('open', { url: 'https://a.test' }),
      /open \(openInUserBrowser\) is not available/u
    );
  });

  it('rejects unknown methods, bad params and bad engines', async () => {
    const { dispatcher } = setup();

    await assert.rejects(dispatcher.dispatch('nope'), { code: -32601 });
    await assert.rejects(dispatcher.dispatch('version', []), { code: -32602 });
    await assert.rejects(
      dispatcher.dispatch('session.launch', { engine: 'selenium' }),
      { code: -32602 }
    );
    await assert.rejects(
      dispatcher.dispatch('session.launch', { browser: 'safari' }),
      { code: -32602 }
    );
    await assert.rejects(dispatcher.dispatch('page.goto', { url: 'x' }), {
      code: -32602,
      message: 'No session; call session.launch first',
    });
  });
});

describe('dispatcher: generic handle methods', () => {
  it('exposes the session objects and calls their methods', async () => {
    const { dispatcher, pages } = setup();
    const { dispatch } = dispatcher;
    await dispatch('session.launch', {});

    const roots = await dispatch('handle.root', { name: 'session:s1' });
    assert.deepEqual(roots, {
      browser: { $handle: 'h1', type: 'Object' },
      context: { $handle: 'h2', type: 'FakeContext' },
      page: { $handle: 'h3', type: 'FakePage' },
    });

    await dispatch('handle.call', {
      handle: roots.page,
      method: 'goto',
      args: ['https://b.test/'],
    });
    assert.equal(pages[0].url(), 'https://b.test/');

    const evaluated = await dispatch('handle.call', {
      handle: 'h3',
      method: 'evaluate',
      args: [{ $function: '(a, b) => a * b' }, 6, 7],
    });
    assert.equal(evaluated, 42);

    assert.deepEqual(
      await dispatch('handle.get', { handle: 'h3', property: 'currentUrl' }),
      'https://b.test/'
    );
    assert.deepEqual(
      await dispatch('handle.call', { handle: 'h2', method: 'pages' }),
      [{ $handle: 'h3', type: 'FakePage' }]
    );

    const description = await dispatch('handle.describe', { handle: 'h3' });
    assert.equal(description.type, 'FakePage');
    for (const method of ['goto', 'fill', 'screenshot', 'on', 'emit']) {
      assert.ok(description.methods.includes(method), method);
    }

    assert.deepEqual(await dispatch('handle.dispose', { handle: 'h3' }), {
      disposed: true,
    });
    await assert.rejects(dispatch('handle.describe', { handle: 'h3' }), {
      code: -32602,
    });
  });

  it('resolves engine roots through the loader', async () => {
    const { dispatcher } = setup();

    const root = await dispatcher.dispatch('handle.root', {
      name: 'puppeteer',
    });
    assert.deepEqual(root, { $handle: 'h1', type: 'FakeEngine' });
    assert.equal(
      await dispatcher.dispatch('handle.call', {
        handle: root,
        method: 'launch',
      }),
      'launched with puppeteer'
    );
    await assert.rejects(
      dispatcher.dispatch('handle.root', { name: 'selenium' }),
      { code: -32602 }
    );
  });

  it('rejects calls to members that are not methods', async () => {
    const { dispatcher } = setup();
    await dispatcher.dispatch('session.launch', {});
    await dispatcher.dispatch('handle.root', { name: 'session:s1' });

    await assert.rejects(
      dispatcher.dispatch('handle.call', { handle: 'h3', method: 'values' }),
      { code: -32602 }
    );
  });

  it('streams subscribed events as events.emit notifications', async () => {
    const { dispatcher, notifications, pages } = setup();
    const { dispatch } = dispatcher;
    await dispatch('session.launch', {});
    await dispatch('handle.root', { name: 'session:s1' });

    const { subscription } = await dispatch('events.subscribe', {
      handle: 'h3',
      event: 'console',
    });
    pages[0].emit('console', 'hello', pages[0]);
    assert.deepEqual(await dispatch('events.unsubscribe', { subscription }), {
      unsubscribed: true,
    });
    pages[0].emit('console', 'ignored');

    assert.equal(subscription, 'e1');
    assert.deepEqual(notifications, [
      {
        method: 'events.emit',
        params: {
          subscription: 'e1',
          args: ['hello', { $handle: 'h3', type: 'FakePage' }],
        },
      },
    ]);
    await assert.rejects(dispatch('events.unsubscribe', { subscription }), {
      code: -32602,
    });
  });

  it('closes sessions and subscriptions on close()', async () => {
    const { dispatcher, launches, pages } = setup();
    await dispatcher.dispatch('session.launch', {});
    await dispatcher.dispatch('session.launch', {});
    await dispatcher.dispatch('handle.root', { name: 'session:s2' });
    await dispatcher.dispatch('events.subscribe', {
      handle: 'h3',
      event: 'load',
    });

    await dispatcher.close();

    assert.deepEqual(
      launches.map((launch) => launch.closed),
      [true, true]
    );
    assert.equal(pages[1].listenerCount('load'), 0);
  });
});

describe('substituteSession', () => {
  it('replaces $session deeply', () => {
    assert.deepEqual(
      substituteSession({ session: '$session', list: ['$session', 1] }, 's2'),
      { session: 's2', list: ['s2', 1] }
    );
    assert.equal(substituteSession('$session', null), '$session');
  });
});
