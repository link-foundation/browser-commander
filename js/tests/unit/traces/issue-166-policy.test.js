import { clearDebugEnvironment } from '../../helpers/debug-environment.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { attachCommanderFeatures } from '../../../src/core/commander-features.js';
import { attachLaunchDebug } from '../../../src/traces/debug-session.js';
import { readTrace } from '../../../src/traces/reader.js';
import { launchBrowserWithDependencies } from '../../../src/browser/launcher.js';
import {
  createFakePage,
  createFakeCommander,
} from '../../helpers/trace-fixtures.js';

describe('opt-in recording policy (issue #166)', { timeout: 15000 }, () => {
  async function fixture(run) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-policy-'));
    const page = createFakePage();
    const commander = createFakeCommander(page, { destroy: async () => {} });
    const restoreEnvironment = clearDebugEnvironment();
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const configureDebug = async (debug) => {
        attachCommanderFeatures(commander, { debug }, () => {});
        await commander.ready;
      };
      await run({ root, page, commander, configureDebug });
    } finally {
      await commander.destroy();
      process.chdir(cwd);
      restoreEnvironment();
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  for (const outputHint of ['none', 'option', 'environment']) {
    it(`navigates without recording or writes with ${outputHint} output hints`, async () => {
      await fixture(async ({ root, page, commander }) => {
        const output = path.join(root, 'unrequested');
        if (outputHint === 'environment') {
          process.env.BROWSER_COMMANDER_TRACE = output;
        }
        attachCommanderFeatures(
          commander,
          outputHint === 'option' ? { output } : {},
          () => {}
        );
        await commander.goto('https://example.com');
        assert.equal(commander.tracePath, null);
        assert.equal(page.listenerCount('request'), 0);
        assert.deepEqual(page.state.initScripts, []);
        assert.deepEqual(await fs.readdir(root), []);
      });
    });
  }

  it('enables recording through BROWSER_COMMANDER_DEBUG=1', async () => {
    await fixture(async ({ root, commander }) => {
      process.env.BROWSER_COMMANDER_DEBUG = '1';
      process.env.BROWSER_COMMANDER_TRACE = path.join(root, 'requested');
      attachCommanderFeatures(commander, {}, () => {});
      await commander.ready;
      assert.equal(commander.tracePath, process.env.BROWSER_COMMANDER_TRACE);
    });
  });

  it('leaves default launches unrecorded', async () => {
    await fixture(async ({ root, page }) => {
      const launched = await attachLaunchDebug({ page }, {});
      assert.equal(launched.tracePath, null);
      assert.deepEqual(await fs.readdir(root), []);
    });
  });

  it('owns a unique managed child, shares it with launch, and discards only that child', async () => {
    await fixture(async ({ root, page, commander }) => {
      const directory = path.join(root, 'evidence');
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, 'keep.txt'), 'caller owned');
      let closed = 0;
      const launched = await attachLaunchDebug(
        {
          page,
          close: async () => {
            closed += 1;
          },
        },
        { debug: { directory, retain: false } }
      );
      attachCommanderFeatures(commander, {}, () => {});
      await commander.ready;
      assert.equal(commander.tracePath, launched.tracePath);
      assert.equal(path.dirname(commander.tracePath), directory);
      await commander.goto('https://example.com');
      await commander.destroy();
      await launched.close();
      assert.equal(closed, 1);
      assert.deepEqual(await fs.readdir(directory), ['keep.txt']);
      assert.deepEqual(await fs.readdir(root), ['evidence']);
    });
  });

  it('retains managed recordings unless discarded, with idempotent explicit stop', async () => {
    await fixture(async ({ root, commander, configureDebug }) => {
      await configureDebug({ directory: root });
      const stopped = await commander.stopDebug();
      assert.equal(stopped, await commander.stopDebug());
      assert.equal(
        (await readTrace(commander.tracePath)).manifest.outcome,
        'complete'
      );
    });
  });

  it('allows explicit discard of a managed child', async () => {
    await fixture(async ({ root, commander, configureDebug }) => {
      await configureDebug({ directory: root });
      const stopped = await commander.stopDebug({ discard: true });
      assert.equal(stopped.discarded, true);
      assert.deepEqual(await fs.readdir(root), []);
    });
  });

  it('leaves later explicit traces intact when debug teardown repeats', async () => {
    await fixture(async ({ root, page, commander, configureDebug }) => {
      await configureDebug({ directory: root, retain: false });
      await commander.stopDebug();
      const first = await commander.startTrace({
        output: path.join(root, 'first-explicit'),
      });
      await commander.stopDebug();
      const second = await commander.startTrace({
        output: path.join(root, 'second-explicit'),
      });
      await first.stop();
      await second.stop();
      let captures = 0;
      page.evaluate = async () => {
        captures += 1;
      };
      await commander.click('#after-teardown');
      assert.equal(captures, 0, 'stopped traces must leave no input labels');
    });
  });

  it('refuses to discard a caller-supplied output directory', async () => {
    await fixture(async ({ root, commander }) => {
      attachCommanderFeatures(commander, { debug: { output: root } }, () => {});
      await commander.ready;
      await assert.rejects(commander.stopDebug({ discard: true }), /managed/);
      await commander.stopDebug();
      assert.equal((await readTrace(root)).manifest.outcome, 'complete');
    });
  });

  it('removes its managed child when recorder startup fails', async () => {
    await fixture(async ({ root, page, commander }) => {
      page.failEvaluate('captureSnapshotInPage', new Error('capture failed'));
      attachCommanderFeatures(
        commander,
        { debug: { directory: root, strict: true } },
        () => {}
      );
      await commander.ready;
      assert.equal(commander.tracePath, null);
      assert.equal(page.listenerCount('request'), 0);
      assert.deepEqual(await fs.readdir(root), []);
    });
  });

  it('cleans managed recording in finally after failed navigation', async () => {
    await fixture(async ({ root, commander }) => {
      commander.goto = async () => {
        throw new Error('navigation failed');
      };
      attachCommanderFeatures(
        commander,
        { debug: { directory: root, retain: false } },
        () => {}
      );
      try {
        await assert.rejects(
          commander.goto('https://example.com'),
          /navigation failed/
        );
      } finally {
        await commander.destroy();
      }
      assert.deepEqual(await fs.readdir(root), []);
    });
  });

  it('stops managed recording automatically at its duration limit', async () => {
    await fixture(async ({ root, commander }) => {
      attachCommanderFeatures(
        commander,
        {
          debug: {
            directory: root,
            retain: false,
            maxDurationMs: 20,
          },
        },
        () => {}
      );
      await commander.ready;
      // Poll actual teardown, bounded by the suite timeout, rather than a fixed sleep.
      while ((await fs.readdir(root)).length) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal((await commander.stopDebug()).discarded, true);
    });
  });

  it('enforces the managed data budget and preserves partial outcome', async () => {
    await fixture(async ({ root, page, commander }) => {
      attachCommanderFeatures(
        commander,
        {
          debug: {
            directory: root,
            limits: { maxBundleBytes: 1024, maxResourceBytes: 512 },
          },
        },
        () => {}
      );
      await commander.ready;
      for (let index = 0; index < 20; index += 1) {
        page.emit('pageerror', new Error('bounded error '.repeat(20)));
      }
      const result = await commander.stopDebug();
      const trace = await readTrace(result.path);
      assert.equal(trace.manifest.outcome, 'partial');
      const events = await fs.stat(path.join(result.path, 'events.ndjson'));
      assert.ok(events.size <= 1024);
      assert.equal(trace.manifest.limits.maxBundleBytes, 1024);
      await assert.rejects(fs.access(path.join(result.path, 'trace.lino')));
    });
  });

  it('does not create recording storage when browser launch fails', async () => {
    await fixture(async ({ root }) => {
      await assert.rejects(
        launchBrowserWithDependencies(
          { debug: { directory: root } },
          {
            resolveSystem: async () => '/usr/bin/google-chrome',
            launchRealBrowser: async () => {
              throw new Error('launch failed');
            },
          }
        ),
        /launch failed/
      );
      assert.deepEqual(await fs.readdir(root), []);
    });
  });

  it('discards its child and closes the browser even when finalization fails', async () => {
    await fixture(async ({ root, page }) => {
      let closed = false;
      const launched = await attachLaunchDebug(
        {
          page,
          close: async () => {
            closed = true;
          },
        },
        {
          debug: { directory: root, retain: false },
        }
      );
      await fs.mkdir(path.join(launched.tracePath, 'manifest.json'));
      await assert.rejects(launched.close(), /EISDIR|EPERM|EACCES/);
      assert.equal(closed, true);
      assert.deepEqual(await fs.readdir(root), []);
    });
  });

  it('validates managed launch configuration before starting the browser', async () => {
    await fixture(async ({ root }) => {
      let started = false;
      await assert.rejects(
        launchBrowserWithDependencies(
          {
            debug: { directory: root, retain: false, maxDurationMs: Infinity },
          },
          {
            launchRealBrowser: async () => {
              started = true;
            },
          }
        ),
        /debug managed/
      );
      assert.equal(started, false);
      assert.deepEqual(await fs.readdir(root), []);
    });
  });

  for (const debug of [false, true, { directory: '.' }]) {
    it(`environment opt-out prevents recording with debug=${JSON.stringify(debug)}`, async () => {
      await fixture(async ({ root, commander }) => {
        process.env.BROWSER_COMMANDER_DEBUG = '0';
        attachCommanderFeatures(commander, { debug }, () => {});
        await commander.ready;
        assert.equal(commander.tracePath, null);
        assert.deepEqual(await fs.readdir(root), []);
      });
    });
  }

  for (const debug of [
    { retain: false },
    { directory: '.', output: 'other' },
    { directory: '.', limits: { maxBundleBytes: Infinity } },
    { directory: '.', limits: { rotate: { maxBytes: 1024 } } },
    { directory: '.', links: { output: '../outside.lino' } },
    { directory: '.', network: { har: '../outside.har' } },
    { directory: '.', maxDurationMs: Infinity },
  ]) {
    it(`rejects unsafe managed settings before writing: ${JSON.stringify(debug)}`, async () => {
      await fixture(async ({ root, commander }) => {
        attachCommanderFeatures(commander, { debug }, () => {});
        await assert.rejects(commander.ready, /debug|managed/);
        commander.ready = Promise.resolve();
        assert.deepEqual(await fs.readdir(root), []);
      });
    });
  }
});
