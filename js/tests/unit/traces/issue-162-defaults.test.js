import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startTrace } from '../../../src/traces/recorder.js';
import { readTrace } from '../../../src/traces/reader.js';
import { attachCommanderFeatures } from '../../../src/core/commander-features.js';
import { launchBrowserWithDependencies } from '../../../src/browser/launcher.js';
import { makeBrowserCommander } from '../../../src/factory.js';
import { attachLaunchDebug } from '../../../src/traces/debug-session.js';
import {
  createFakePage,
  createFakeCommander,
} from '../../helpers/trace-fixtures.js';

describe('complete recording defaults (issue #162)', { timeout: 15000 }, () => {
  async function fixture(run) {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-defaults-'));
    const page = createFakePage();
    const commander = createFakeCommander(page, { destroy: async () => {} });
    const previous = { ...process.env };
    delete process.env.BROWSER_COMMANDER_DEBUG;
    delete process.env.BROWSER_COMMANDER_TRACE;
    try {
      await run({ output, page, commander });
    } finally {
      await commander.destroy();
      for (const key of [
        'BROWSER_COMMANDER_DEBUG',
        'BROWSER_COMMANDER_TRACE',
      ]) {
        if (previous[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = previous[key];
        }
      }
      await fs.rm(output, { recursive: true, force: true });
    }
  }

  it('captures an initial snapshot, changes, actions and network with a default links file', async () => {
    await fixture(async ({ output, page, commander }) => {
      const trace = await startTrace({ commander, output, screenshots: false });
      try {
        assert.equal(trace.mode, 'continuous');
        assert.equal(trace.checkpoints[0].name, 'initial');
        assert.equal(trace.links, path.join(output, 'trace.lino'));
        assert.ok(page.listenerCount('request') > 0);
        assert.ok(
          page.state.initScripts.some(
            (call) => call.name === 'installMutationRecorderInPage'
          )
        );
        await commander.click('#delete');
      } finally {
        await trace.stop();
      }
      const opened = await readTrace(output);
      assert.equal(
        opened.events.find((event) => event.kind === 'interaction').source,
        'commander'
      );
      assert.match(
        await fs.readFile(trace.links, 'utf8'),
        /initial|dom-snapshot/
      );
    });
  });

  it('preserves explicit checkpoint, network and links opt-outs', async () => {
    await fixture(async ({ output, page, commander }) => {
      const trace = await startTrace({
        commander,
        output,
        mode: 'checkpoints',
        network: false,
        links: false,
      });
      try {
        assert.equal(trace.mode, 'checkpoints');
        assert.equal(trace.checkpoints.length, 0);
        assert.equal(trace.links, null);
        assert.equal(page.listenerCount('request'), 0);
      } finally {
        await trace.stop();
      }
    });
  });

  it('rejects unbounded action queues before opening recording files', async () => {
    await fixture(async ({ output, page }) => {
      for (const maxQueuedUserActions of [Infinity, 0, -1, 1.5]) {
        await assert.rejects(
          startTrace({ page, output, limits: { maxQueuedUserActions } }),
          /maxQueuedUserActions/
        );
      }
      assert.deepEqual(await fs.readdir(output), []);
    });
  });

  it('starts commander debugging immediately, and finalizes it on destroy', async () => {
    await fixture(async ({ output, commander }) => {
      attachCommanderFeatures(commander, { debug: { output } }, () => {});
      assert.ok(commander.ready instanceof Promise);
      await commander.ready;
      assert.equal(commander.tracePath, output);
      await commander.destroy();
      assert.equal((await readTrace(output)).manifest.mode, 'continuous');
    });
  });

  it('records the very first call with no options and chooses a unique session directory', async () => {
    await fixture(async ({ output, page }) => {
      const cwd = process.cwd();
      process.chdir(output);
      page.locator = () => ({});
      page.context = () => ({});
      page.url = () => 'https://example.com/first';
      let commander;
      try {
        commander = makeBrowserCommander({
          page,
          enableNetworkTracking: false,
          enableNavigationManager: false,
          enableDialogManager: false,
        });
        page.goto = async () => true;
        await commander.goto({
          url: 'https://example.com/first',
          waitAfter: false,
        });
        assert.match(
          commander.tracePath,
          /browser-commander-traces[/\\].+-\d+-[a-f0-9]{8}$/
        );
        await commander.destroy();
        const trace = await readTrace(commander.tracePath);
        assert.equal(
          trace.events.filter((event) => event.source === 'commander').length,
          1
        );
      } finally {
        await commander?.destroy();
        process.chdir(cwd);
      }
    });
  });

  for (const disabled of ['option', 'environment']) {
    it(`respects the ${disabled} opt-out even with BROWSER_COMMANDER_TRACE`, async () => {
      await fixture(async ({ output, page, commander }) => {
        process.env.BROWSER_COMMANDER_TRACE = output;
        if (disabled === 'environment') {
          process.env.BROWSER_COMMANDER_DEBUG = '0';
        }
        attachCommanderFeatures(
          commander,
          disabled === 'option' ? { debug: false } : {},
          () => {}
        );
        await commander.ready;
        assert.equal(page.listenerCount('request'), 0);
        assert.equal(commander.tracePath, null);
      });
    });
  }

  it('keeps a launch opt-out when a default commander adopts the page', async () => {
    await fixture(async ({ output, page, commander }) => {
      const launched = await attachLaunchDebug({ page }, { debug: false });
      attachCommanderFeatures(commander, { output }, () => {});
      await commander.ready;
      assert.equal(launched.tracePath, null);
      assert.equal(commander.tracePath, null);
      assert.equal(page.listenerCount('request'), 0);
    });
  });

  it('starts a launch recording before returning, reuses it in a commander, and closes it', async () => {
    await fixture(async ({ output, page, commander }) => {
      let closed = 0;
      page.bringToFront = async () => {};
      const browser = {
        pages: () => [page],
        close: async () => {
          closed += 1;
        },
      };
      const launched = await launchBrowserWithDependencies(
        { debug: { output } },
        {
          resolveSystem: async () => '/usr/bin/google-chrome',
          settleMs: 0,
          launchRealBrowser: async () => ({
            page,
            browser: { contexts: () => [browser] },
            close: browser.close,
          }),
        }
      );
      try {
        assert.equal(launched.tracePath, output);
        const requests = page.listenerCount('request');
        attachCommanderFeatures(commander, {}, () => {});
        await commander.ready;
        assert.equal(commander.tracePath, output);
        assert.equal(page.listenerCount('request'), requests);
        await commander.click('#delete');
      } finally {
        await launched.close();
      }
      assert.equal(closed, 1);
      const opened = await readTrace(output);
      assert.equal(
        opened.events.filter((event) => event.kind === 'interaction').length,
        1
      );
    });
  });
});
