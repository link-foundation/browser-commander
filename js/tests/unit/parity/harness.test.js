/**
 * The reference capture starts a browser nothing automates and waits for the
 * probe page to POST its report. A browser that cannot start at all (no usable
 * sandbox, a rejected switch) never reports, so the capture has to fail with
 * the browser's own exit code and stderr rather than a bare 60 s timeout.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { captureReferenceReport } from '../../../src/parity/harness.js';

function fakeProcess({ exitCode, stderr = '' }) {
  const listeners = new Set();
  let resolveExit;
  const child = {
    exited: new Promise((resolve) => {
      resolveExit = resolve;
    }),
    stderr: {
      on(event, listener) {
        listeners.add(listener);
      },
    },
    kill() {
      resolveExit(143);
    },
  };
  setTimeout(() => {
    for (const listener of listeners) {
      listener(stderr);
    }
    if (exitCode !== null) {
      resolveExit(exitCode);
    }
  }, 0);
  return child;
}

function fakeServer({ report = null } = {}) {
  return {
    url: (token) => `http://127.0.0.1:1/probe/${token}`,
    waitForReport: (token, timeoutMs) =>
      report
        ? new Promise((resolve) => setTimeout(() => resolve(report), 20))
        : new Promise((resolve, reject) =>
            setTimeout(
              () => reject(new Error(`timed out waiting for report ${token}`)),
              timeoutMs
            )
          ),
  };
}

describe('captureReferenceReport', () => {
  it('fails fast with the exit code and stderr of a browser that died', async () => {
    const started = Date.now();
    await assert.rejects(
      captureReferenceReport({
        executablePath: '/usr/bin/chromium',
        server: fakeServer(),
        token: 't1',
        timeoutMs: 3000,
        start: () =>
          fakeProcess({
            exitCode: 1,
            stderr: 'FATAL: No usable sandbox!',
          }),
      }),
      (error) => {
        assert.match(error.message, /\/usr\/bin\/chromium exited with code 1/);
        assert.match(error.message, /No usable sandbox/);
        return true;
      }
    );
    assert.ok(Date.now() - started < 5000);
  });

  it('includes stderr when the report times out', async () => {
    await assert.rejects(
      captureReferenceReport({
        server: fakeServer(),
        token: 't2',
        timeoutMs: 50,
        start: () => fakeProcess({ exitCode: null, stderr: 'GPU init failed' }),
      }),
      /timed out waiting for report t2\nbrowser stderr:\nGPU init failed/
    );
  });

  it('keeps waiting when a launcher script exits cleanly', async () => {
    const report = await captureReferenceReport({
      server: fakeServer({ report: { navigator: { webdriver: false } } }),
      token: 't3',
      start: () => fakeProcess({ exitCode: 0 }),
    });
    assert.deepEqual(report, { navigator: { webdriver: false } });
    assert.ok(Array.isArray(report.commandLine));
  });
});
