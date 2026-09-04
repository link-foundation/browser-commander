import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  applyFingerprint,
  createCdpSession,
} from '../../../src/fingerprint/apply.js';
import { createFingerprintPreset } from '../../../src/fingerprint/presets.js';

/** A CDP session that records what was sent instead of talking to Chrome. */
function createRecordingSession() {
  const sent = [];
  return {
    sent,
    methods: () => sent.map((entry) => entry.method),
    send(method, params) {
      sent.push({ method, params });
      return Promise.resolve({});
    },
  };
}

/** Minimal stand-ins for the two engines' object graphs. */
function createPlaywrightDouble() {
  const session = createRecordingSession();
  const listeners = new Map();
  const page = {};
  const browser = {
    newCDPSession(target) {
      browser.cdpTargets.push(target);
      return Promise.resolve(session);
    },
    cdpTargets: [],
    on(event, handler) {
      listeners.set(event, handler);
    },
    emit: (event, argument) => listeners.get(event)?.(argument),
    listeners,
  };
  return { browser, page, session };
}

function createPuppeteerDouble() {
  const session = createRecordingSession();
  const listeners = new Map();
  const page = {
    createCDPSession: () => Promise.resolve(session),
  };
  const browser = {
    on(event, handler) {
      listeners.set(event, handler);
    },
    emit: (event, argument) => listeners.get(event)?.(argument),
    listeners,
  };
  return { browser, page, session };
}

describe('opening a CDP session', () => {
  it('uses the Playwright context that launchBrowser hands back', async () => {
    const { browser, page, session } = createPlaywrightDouble();

    assert.equal(
      await createCdpSession({ browser, page, engine: 'playwright' }),
      session
    );
    assert.deepEqual(browser.cdpTargets, [page]);
  });

  it('falls back to the page context when the browser has no newCDPSession', async () => {
    const session = createRecordingSession();
    const context = { newCDPSession: () => Promise.resolve(session) };
    const page = { context: () => context };

    assert.equal(
      await createCdpSession({ browser: {}, page, engine: 'playwright' }),
      session
    );
  });

  it('uses page.createCDPSession on Puppeteer', async () => {
    const { page, session } = createPuppeteerDouble();

    assert.equal(
      await createCdpSession({ browser: {}, page, engine: 'puppeteer' }),
      session
    );
  });

  it('falls back to the target on older Puppeteer pages', async () => {
    const session = createRecordingSession();
    const page = {
      target: () => ({ createCDPSession: () => Promise.resolve(session) }),
    };

    assert.equal(
      await createCdpSession({ browser: {}, page, engine: 'puppeteer' }),
      session
    );
  });
});

describe('applying a fingerprint', () => {
  const profile = createFingerprintPreset('windows-chrome');

  it('requires a page', async () => {
    await assert.rejects(
      () => applyFingerprint({ profile }),
      /requires a page/u
    );
  });

  it('sends the emulation commands before installing the init script', async () => {
    const { browser, page, session } = createPlaywrightDouble();

    await applyFingerprint({ browser, page, engine: 'playwright', profile });

    const methods = session.methods();
    const firstScriptIndex = methods.indexOf('Page.enable');
    assert.ok(firstScriptIndex > 0);
    assert.ok(
      methods
        .slice(0, firstScriptIndex)
        .every((method) => method.startsWith('Emulation.'))
    );
  });

  it('enables the Page domain before adding the script, then patches the open document', async () => {
    const { browser, page, session } = createPlaywrightDouble();

    await applyFingerprint({ browser, page, engine: 'playwright', profile });

    // Measured: without Page.enable, Chrome accepts
    // addScriptToEvaluateOnNewDocument and never runs the script.
    assert.deepEqual(
      session.methods().filter((method) => !method.startsWith('Emulation.')),
      [
        'Page.enable',
        'Page.addScriptToEvaluateOnNewDocument',
        'Runtime.evaluate',
      ]
    );
    const [, added, evaluated] = session.sent.slice(-3);
    assert.equal(added.params.source, evaluated.params.expression);
    assert.equal(evaluated.params.returnByValue, true);
  });

  it('normalizes a raw profile and reports what it sent', async () => {
    const { browser, page, session } = createPlaywrightDouble();

    const result = await applyFingerprint({
      browser,
      page,
      engine: 'playwright',
      profile: { timezoneId: 'Europe/Berlin', deviceMemory: 8 },
    });

    assert.ok(Object.isFrozen(result.profile));
    assert.deepEqual(result.commands, [
      {
        method: 'Emulation.setTimezoneOverride',
        params: { timezoneId: 'Europe/Berlin' },
      },
    ]);
    assert.match(result.initScript, /deviceMemory/u);
    assert.equal(session.methods()[0], 'Emulation.setTimezoneOverride');
  });

  it('rejects a raw profile with an unknown field', async () => {
    const { browser, page } = createPlaywrightDouble();

    await assert.rejects(
      () => applyFingerprint({ browser, page, profile: { cpuModel: 'M3' } }),
      /cpuModel/u
    );
  });

  it('skips the script commands when the browser overrides cover everything', async () => {
    const { browser, page, session } = createPlaywrightDouble();

    const result = await applyFingerprint({
      browser,
      page,
      engine: 'playwright',
      profile: { timezoneId: 'UTC' },
    });

    assert.equal(result.initScript, null);
    assert.deepEqual(session.methods(), ['Emulation.setTimezoneOverride']);
  });

  it('applies the same profile to a page opened later on Playwright', async () => {
    const { browser, page, session } = createPlaywrightDouble();

    await applyFingerprint({ browser, page, engine: 'playwright', profile });
    const before = session.sent.length;
    const laterPage = {};
    await browser.emit('page', laterPage);

    assert.equal(session.sent.length, before * 2);
    assert.deepEqual(browser.cdpTargets, [page, laterPage]);
  });

  it('applies the same profile to a target opened later on Puppeteer', async () => {
    const { browser, page, session } = createPuppeteerDouble();

    await applyFingerprint({ browser, page, engine: 'puppeteer', profile });
    const before = session.sent.length;
    await browser.emit('targetcreated', {
      page: () =>
        Promise.resolve({ createCDPSession: () => Promise.resolve(session) }),
    });

    assert.equal(session.sent.length, before * 2);
  });

  it('ignores a new target that is not a page', async () => {
    const { browser, page, session } = createPuppeteerDouble();

    await applyFingerprint({ browser, page, engine: 'puppeteer', profile });
    const before = session.sent.length;
    await browser.emit('targetcreated', { page: () => Promise.resolve(null) });

    assert.equal(session.sent.length, before);
  });

  it('survives a page that closes before its session is ready', async () => {
    const { browser, page } = createPlaywrightDouble();

    await applyFingerprint({ browser, page, engine: 'playwright', profile });
    browser.newCDPSession = () => Promise.reject(new Error('Target closed'));

    await assert.doesNotReject(() => browser.emit('page', {}));
  });

  it('does not hook new pages when asked not to', async () => {
    const { browser, page } = createPlaywrightDouble();

    await applyFingerprint({
      browser,
      page,
      engine: 'playwright',
      profile,
      applyToNewPages: false,
    });

    assert.equal(browser.listeners.size, 0);
  });

  it('adds the webdriver patch only when asked', async () => {
    const { browser, page } = createPlaywrightDouble();

    const plain = await applyFingerprint({
      browser,
      page,
      engine: 'playwright',
      profile: { timezoneId: 'UTC' },
    });
    assert.equal(plain.initScript, null);

    const patched = await applyFingerprint({
      browser,
      page,
      engine: 'playwright',
      profile: { timezoneId: 'UTC' },
      patchWebdriver: true,
      applyToNewPages: false,
    });
    assert.match(patched.initScript, /"webdriver":false/u);
  });
});
