// feature-parity: launch.diagnostics@native-typed
import { it } from 'node:test';
import { redactLaunchEvidence } from '../../../src/browser/launch-diagnostics.js';

it('diagnostics scrub URL credentials and queries and bound multibyte evidence', () => {
  const redacted = redactLaunchEvidence(
    'https://user:private@example.test/secret?access=private'
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
