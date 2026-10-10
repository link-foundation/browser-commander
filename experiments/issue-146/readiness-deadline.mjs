// Bounded real-browser probe for a readiness timer/clock disagreement.
import assert from 'node:assert/strict';
import { chromium } from '../../js/node_modules/playwright/index.mjs';
import { createCommander } from '../../js/src/index.js';
import { startFixtureServer } from '../../js/tests/helpers/readiness-server.js';

const server = await startFixtureServer();
let browser;
let commander;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  commander = createCommander({ page, engine: 'playwright' });
  await page.goto(`${server.baseUrl}/never-idle`, {
    waitUntil: 'domcontentloaded',
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await commander.waitForReady({ timeout: 1500 });
    console.log(JSON.stringify({ attempt, ...result }));
    assert.equal(result.status, 'timed_out');
  }
} finally {
  await commander?.destroy();
  await browser?.close();
  await server.close();
}
