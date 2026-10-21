import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startTrace } from '../../../src/traces/recorder.js';
import { TRACE_MODE } from '../../../src/traces/schema.js';
import { screenshot } from '../../../src/capture/index.js';
import {
  createFakeCommander,
  createFakePage,
  useTempTraceDirectory,
} from '../../helpers/trace-fixtures.js';

/**
 * A clipped engine screenshot of a headful window can leave Chrome's emulated
 * size stuck after a resize (issue #180). Without a fixed viewport, captures
 * go through CDP `Page.captureScreenshot` with no `clip`.
 */
function cdpFake({ viewport = null, failWith, engine = 'playwright' } = {}) {
  const calls = { cdp: [], engine: [], detached: 0 };
  const session = {
    send: async (method, params) => {
      calls.cdp.push({ method, params });
      if (failWith) {
        throw new Error(failWith);
      }
      return { data: Buffer.from('cdp-png').toString('base64') };
    },
    detach: async () => {
      calls.detached += 1;
    },
  };
  const page = createFakePage();
  page.screenshot = async (options) => {
    calls.engine.push(options);
    return Buffer.from('engine-png');
  };
  if (engine === 'playwright') {
    page.context = () => ({ newCDPSession: async () => session });
    page.viewportSize = () => viewport;
  } else {
    page.createCDPSession = async () => session;
    page.viewport = () => viewport;
  }
  return { page, calls };
}

describe('trace checkpoint screenshots (issue #180)', () => {
  const directory = useTempTraceDirectory();

  async function checkpointShot(page, { withCommander = true, engine } = {}) {
    const commander = createFakeCommander(page, engine ? { engine } : {});
    const trace = await startTrace({
      page,
      ...(withCommander ? { commander } : {}),
      output: path.join(directory.path, 'run'),
      mode: TRACE_MODE.CHECKPOINTS,
      network: false,
      links: false,
      screenshots: true,
    });
    await trace.checkpoint('resized');
    const stopped = await trace.stop();
    return (
      await fs.readFile(path.join(stopped.path, 'checkpoints/0001.png'))
    ).toString();
  }

  for (const engine of ['playwright', 'puppeteer']) {
    for (const withCommander of [true, false]) {
      it(`${engine} ${withCommander ? 'commander' : 'bare page'} without a fixed viewport sends no clip`, async () => {
        const { page, calls } = cdpFake({ engine });
        assert.equal(
          await checkpointShot(page, { withCommander, engine }),
          'cdp-png'
        );
        assert.deepEqual(calls.cdp, [
          {
            method: 'Page.captureScreenshot',
            params: {
              format: 'png',
              fromSurface: false,
              captureBeyondViewport: false,
            },
          },
        ]);
        assert.equal(calls.engine.length, 0);
        assert.equal(calls.detached, 1);
      });
    }
  }

  it('a fixed viewport keeps the engine screenshot', async () => {
    const { page, calls } = cdpFake({
      viewport: { width: 800, height: 600 },
    });
    assert.equal(await checkpointShot(page), 'engine-png');
    assert.equal(calls.cdp.length, 0);
    assert.deepEqual(calls.engine, [{ type: 'png' }]);
  });

  it('falls back to the engine screenshot when the view cannot be captured', async () => {
    const { page, calls } = cdpFake({
      failWith: 'Unable to capture screenshot',
    });
    assert.equal(await checkpointShot(page), 'engine-png');
    assert.equal(calls.cdp.length, 1);
    assert.equal(calls.detached, 1);
  });

  it('a page without CDP keeps the engine screenshot', async () => {
    const page = createFakePage();
    assert.equal(
      await checkpointShot(page, { withCommander: false }),
      'fake-png'
    );
  });
});

describe('default commander screenshots (issue #180)', () => {
  for (const engine of ['playwright', 'puppeteer']) {
    it(`${engine} without a fixed viewport sends no clip`, async () => {
      const { page, calls } = cdpFake({ engine });
      assert.equal((await screenshot({ page, engine })).toString(), 'cdp-png');
      assert.equal(calls.cdp.length, 1);
      assert.equal('clip' in calls.cdp[0].params, false);
      assert.equal(calls.engine.length, 0);
    });

    it(`${engine} with a fixed viewport keeps the engine screenshot`, async () => {
      const { page, calls } = cdpFake({
        engine,
        viewport: { width: 800, height: 600 },
      });
      assert.equal(
        (await screenshot({ page, engine })).toString(),
        'engine-png'
      );
      assert.equal(calls.cdp.length, 0);
      assert.equal(calls.engine[0].fullPage, false);
    });
  }

  it('JPEG quality reaches the view capture', async () => {
    const { page, calls } = cdpFake();
    await screenshot({ page, format: 'jpeg', quality: 60 });
    assert.deepEqual(calls.cdp[0].params, {
      format: 'jpeg',
      fromSurface: false,
      captureBeyondViewport: false,
      quality: 60,
    });
  });

  for (const options of [
    { fullPage: true },
    { clip: { x: 0, y: 0, width: 1, height: 1 } },
    { selector: '#pager' },
    { omitBackground: true },
    { hideScrollbars: true },
    { animations: 'disabled' },
    { scale: 'css' },
    { stableViewport: false },
  ]) {
    it(`${JSON.stringify(options)} keeps the engine screenshot`, async () => {
      const { page, calls } = cdpFake();
      page.locator = () => ({ first: () => page });
      await screenshot({ page, ...options });
      assert.equal(calls.cdp.length, 0);
      assert.equal(calls.engine.length, 1);
    });
  }
});
