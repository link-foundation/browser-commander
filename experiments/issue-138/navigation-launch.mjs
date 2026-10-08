// Revalidate issues 134/135 using an authored page and a deliberately bad binary.
// Usage: node experiments/issue-138/navigation-launch.mjs [--no-sandbox]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { launchRealBrowser, makeBrowserCommander } from '../../js/src/index.js';

const requireEngine = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { chromium } = requireEngine('playwright');
const browser = await chromium.launch({
  headless: true,
  args: process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : [],
});
const rows = [];
try {
  for (const enableNetworkTracking of [false, true]) {
    const page = await browser.newPage();
    const commander = makeBrowserCommander({
      page,
      engine: 'playwright',
      enableNetworkTracking,
      logLevel: 'none',
    });
    try {
      const started = performance.now();
      const result = await commander.goto({
        url: 'data:text/html,<h1>Authored contract fixture</h1>',
        timeout: 4000,
        verify: false,
        waitForStableUrlBefore: false,
        waitForStableUrlAfter: false,
        waitForNetworkIdle: false,
      });
      const elapsedMs = Math.round(performance.now() - started);
      assert.equal(result.navigated, true);
      assert.ok(elapsedMs < 4500);
      assert.equal(
        await page.locator('h1').textContent(),
        'Authored contract fixture'
      );
      rows.push({ enableNetworkTracking, elapsedMs, status: result.status });
    } finally {
      await commander.destroy();
      await page.close();
    }
  }
} finally {
  await browser.close();
}
await assert.rejects(
  () =>
    launchRealBrowser({
      engine: 'playwright',
      executablePath: process.execPath,
      headless: true,
      startupTimeout: 2000,
    }),
  (error) => {
    assert.equal(error.name, 'BrowserLaunchError');
    assert.equal(error.phase, 'endpoint');
    assert.equal(error.category, 'early_exit');
    assert.ok(error.cause);
    assert.match(error.stderrTail, /bad option/);
    assert.ok(Buffer.byteLength(error.stderrTail) <= 4096);
    rows.push({
      launchPhase: error.phase,
      category: error.category,
      exitCode: error.exitCode,
      boundedEvidence: true,
    });
    return true;
  }
);
console.log(JSON.stringify(rows, null, 2));
