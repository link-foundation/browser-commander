import { it } from 'node:test';
import assert from 'node:assert/strict';
import { screenshot } from '../../../src/capture/index.js';
import { parseCommandLine } from '../../../src/cli/args.js';

function cdpPage(session, capture) {
  return {
    context: () => ({ newCDPSession: async () => session }),
    createCDPSession: async () => session,
    screenshot: capture,
  };
}

for (const engine of ['playwright', 'puppeteer']) {
  it(`${engine} emulated viewports preserve engine pixel scaling`, async () => {
    const page = cdpPage(
      {
        send: async () => assert.fail('native view ignores emulation'),
        detach: async () => {},
      },
      async (options) => {
        assert.equal(options.fullPage, false);
        return Buffer.from('emulated viewport');
      }
    );
    page.viewportSize = () => ({ width: 320, height: 200 });
    page.viewport = () => ({ width: 320, height: 200, deviceScaleFactor: 2 });
    assert.equal(
      (await screenshot({ page, engine, stableViewport: true })).toString(),
      'emulated viewport'
    );
  });
}

it('Puppeteer BiDi without CDP uses a viewport-only fallback', async () => {
  const error = Object.assign(new Error(''), { name: 'UnsupportedOperation' });
  const page = {
    createCDPSession: async () => {
      throw error;
    },
    screenshot: async (options) => {
      assert.equal(options.fullPage, false);
      return Buffer.from('bidi viewport');
    },
  };
  assert.equal(
    (
      await screenshot({ page, engine: 'puppeteer', stableViewport: true })
    ).toString(),
    'bidi viewport'
  );
});

it('the shared CLI parses stable viewport capture', () => {
  assert.equal(
    parseCommandLine(['screenshot', 'viewport.png', '--stable-viewport'])
      .options.stableViewport,
    true
  );
});
it('Firefox without CDP falls back to its existing viewport', async () => {
  const page = {
    context: () => ({
      newCDPSession: async () => {
        throw new Error('CDP sessions are only supported by Chromium');
      },
    }),
    screenshot: async (options) => {
      assert.equal(options.fullPage, false);
      assert.equal(options.caret, 'initial');
      return Buffer.from('firefox viewport');
    },
  };
  assert.equal(
    (await screenshot({ page, stableViewport: true })).toString(),
    'firefox viewport'
  );
});

for (const engine of ['playwright', 'puppeteer']) {
  it(`${engine} stable viewport captures the view and detaches CDP`, async () => {
    let detached = false;
    const session = {
      send: async (method, options) => {
        assert.equal(method, 'Page.captureScreenshot');
        assert.deepEqual(options, {
          format: 'png',
          fromSurface: false,
          captureBeyondViewport: false,
        });
        return { data: Buffer.from('viewport').toString('base64') };
      },
      detach: async () => {
        detached = true;
      },
    };
    const page = cdpPage(session, async () =>
      assert.fail('view capture must bypass engine screenshot')
    );
    assert.equal(
      (await screenshot({ page, engine, stableViewport: true })).toString(),
      'viewport'
    );
    assert.equal(detached, true);
  });
  it(`${engine} stable viewport has a viewport-only headless fallback`, async () => {
    let detached = false;
    const session = {
      send: async () => {
        throw new Error('Unable to capture screenshot');
      },
      detach: async () => {
        detached = true;
      },
    };
    const page = cdpPage(session, async (options) => {
      assert.equal(options.fullPage, false);
      return Buffer.from('fallback');
    });
    assert.equal(
      (await screenshot({ page, engine, stableViewport: true })).toString(),
      'fallback'
    );
    assert.equal(detached, true);
  });
}
it('stable viewport rejects regions and visual capture styling', async () => {
  for (const options of [
    { fullPage: true },
    { selector: '#pager' },
    { clip: { x: 0, y: 0, width: 1, height: 1 } },
    { hideCaret: true },
    { animations: 'disabled' },
    { omitBackground: true },
  ]) {
    await assert.rejects(
      screenshot({
        page: { screenshot: async () => Buffer.alloc(0) },
        stableViewport: true,
        ...options,
      }),
      /stableViewport/
    );
  }
});
it('stable viewport preserves genuine protocol errors and detaches', async () => {
  const error = new Error('Target closed');
  let detached = false;
  const page = {
    context: () => ({
      newCDPSession: async () => ({
        send: async () => {
          throw error;
        },
        detach: async () => {
          detached = true;
        },
      }),
    }),
    screenshot: async () =>
      assert.fail('unrelated errors must not invoke fallback'),
  };
  await assert.rejects(
    screenshot({ page, stableViewport: true }),
    (actual) => actual === error
  );
  assert.equal(detached, true);
});
