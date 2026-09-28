// Reproduction (#101): measure navigator.webdriver in a launchRealBrowser
// session. Before the fix this prints `true` (port 0 => AutomationControlled).
// Usage: xvfb-run -a node experiments/issue-105/webdriver-real-browser.mjs
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchRealBrowser } from '../../js/src/browser/real-browser.js';

const channel = process.env.CHANNEL ?? 'chrome';
const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'bc-webdriver-'));
const session = await launchRealBrowser({
  engine: process.env.ENGINE ?? 'playwright',
  channel,
  userDataDir,
  headless: false,
});
try {
  const webdriver = await session.page.evaluate(() => navigator.webdriver);
  console.log(
    JSON.stringify({ channel, cdpEndpoint: session.cdpEndpoint, webdriver })
  );
} finally {
  await session.browser.close().catch(() => {});
  session.browserProcess.kill();
  await new Promise((r) => setTimeout(r, 500));
  await rm(userDataDir, { recursive: true, force: true });
}
