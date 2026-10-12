// feature-parity: launch.diagnostics@native-typed
import { it } from 'node:test';
import {
  launchFailure,
  redactLaunchEvidence,
} from '../../../src/browser/launch-diagnostics.js';

it('retains the attachment timeout alongside incidental Chrome stderr', () => {
  const error = launchFailure(
    new Error(
      'connectOverCDP: Timeout 30000ms exceeded; <ws connected> ws://127.0.0.1:9222/devtools/browser/private'
    ),
    {
      phase: 'connect',
      browserProcess: {
        exitCode: null,
        stderrTail:
          'DevTools listening on ws://127.0.0.1:9222/devtools/browser/private\nCVDisplayLinkCreateWithCGDisplay failed',
      },
    }
  );
  assert.match(error.message, /connectOverCDP: Timeout 30000ms exceeded/);
  assert.match(error.message, /CVDisplayLinkCreateWithCGDisplay failed/);
  assert.doesNotMatch(error.message, /devtools|private|127\.0\.0\.1/);
});

it('diagnostics scrub URL credentials and queries and bound multibyte evidence', () => {
  const redacted = redactLaunchEvidence(
    ['https://', 'user:', 'private@example.test/secret?access=private'].join('')
  );
  assert.doesNotMatch(redacted, /private|example\.test/);
  assert.ok(Buffer.byteLength(redactLaunchEvidence('😀'.repeat(4096))) <= 4096);
});
import assert from 'node:assert/strict';
import { launchRealBrowser } from '../../../src/browser/real-browser.js';

it('bad executable preserves bounded, redacted structured early-exit evidence', async () => {
  await assert.rejects(
    () =>
      launchRealBrowser({
        engine: 'playwright',
        executablePath: process.execPath,
        headless: true,
        startupTimeout: 1000,
      }),
    (error) => {
      assert.equal(error.name, 'BrowserLaunchError');
      assert.equal(error.phase, 'endpoint');
      assert.equal(error.engine, 'playwright');
      assert.equal(error.category, 'early_exit');
      assert.equal(typeof error.exitCode, 'number');
      assert.match(error.stderrTail, /bad option/);
      assert.ok(error.cause);
      assert.ok(error.stderrTail.length <= 4096);
      return true;
    }
  );
});

it('missing executable is classified without exposing its path', async () => {
  await assert.rejects(
    () =>
      launchRealBrowser({
        executablePath: '/private/secret-token/missing-browser',
      }),
    (error) => {
      assert.equal(error.name, 'BrowserLaunchError');
      assert.equal(error.category, 'missing_executable');
      assert.ok(!JSON.stringify(error).includes('secret-token'));
      assert.ok(!error.message.includes('secret-token'));
      return true;
    }
  );
});
