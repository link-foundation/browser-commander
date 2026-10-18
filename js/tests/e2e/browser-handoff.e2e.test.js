/**
 * Issue #174: an embedding supervisor owns Ctrl+C for the browser it launched,
 * hands the exact browser and tab to its next run, and that run closes it.
 */
// feature-parity: process.interruption@native-typed sessions.handoff@native-typed
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  reconnectBrowser,
  waitForPidExit,
} from '../../src/browser/browser-handoff.js';
import { startProcess } from '../../src/utilities/subprocess.js';
import { repoPath } from '../helpers/repo.js';

const SUPERVISOR = repoPath(
  'experiments',
  'issue-174',
  'browser-supervisor.mjs'
);

/** Run the supervisor, which interrupts itself after opening a page. */
async function interruptSupervisor(mode, engine) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bc-e2e-174-'));
  const handoffFile = path.join(directory, 'handoff.json');
  try {
    const supervisor = startProcess(process.execPath, [
      SUPERVISOR,
      mode,
      engine,
      handoffFile,
    ]);
    const exitCode = await supervisor.exited;
    const pid = Number(await readFile(`${handoffFile}.pid`, 'utf8'));
    const handoff = await readFile(handoffFile, 'utf8').catch(() => null);
    return { exitCode, pid, handoff, stderr: supervisor.stderrTail };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe(
  'browser hand-off across an embedding supervisor (issue #174)',
  {
    skip:
      (!process.env.RUN_E2E && 'set RUN_E2E=true') ||
      (process.platform === 'win32' && 'SIGINT forwarding is Unix-only'),
    timeout: 120000,
  },
  () => {
    it('by default Ctrl+C reaches Chrome before the embedder can keep it', async () => {
      const { exitCode, pid, handoff } = await interruptSupervisor(
        'managed',
        'playwright'
      );
      assert.equal(exitCode, 130);
      assert.equal(handoff, null);
      assert.equal(await waitForPidExit(pid, 10000), true);
    });

    for (const engine of ['playwright', 'puppeteer', 'selenium']) {
      it(`${engine}: keeps the exact tab across Ctrl+C and closes it later`, async () => {
        const { exitCode, pid, handoff, stderr } = await interruptSupervisor(
          'caller',
          engine
        );
        assert.equal(exitCode, 130, stderr);
        assert.ok(handoff, stderr);
        const descriptor = JSON.parse(handoff);
        assert.equal(descriptor.pid, pid);
        try {
          assert.equal(await waitForPidExit(pid, 500), false);
          const session = await reconnectBrowser(handoff);
          const title =
            engine === 'selenium'
              ? await session.browser.getTitle()
              : await session.page.title();
          assert.equal(title, 'waiting for a human');
          await session.close();
          assert.equal(await waitForPidExit(pid, 1000), true);
          await assert.rejects(readFile(descriptor.userDataDir), {
            code: 'ENOENT',
          });
        } finally {
          if (!(await waitForPidExit(pid, 0))) {
            process.kill(-pid, 'SIGKILL');
          }
        }
      });
    }
  }
);
