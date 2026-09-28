// Verifies that session.close() stops Chrome and deletes the temporary
// profile for both engines, and that navigator.webdriver stays false.
// Usage: xvfb-run -a node experiments/issue-105/real-browser-close.mjs
import { access } from 'node:fs/promises';
import { launchRealBrowser } from '../../js/src/browser/real-browser.js';

for (const engine of ['playwright', 'puppeteer']) {
  for (const headless of [false, true]) {
    const session = await launchRealBrowser({ engine, headless });
    const webdriver = await session.page.evaluate(() => navigator.webdriver);
    const started = Date.now();
    await session.close();
    const profileGone = await access(session.userDataDir).then(
      () => false,
      () => true
    );
    console.log(
      JSON.stringify({
        engine,
        headless,
        webdriver,
        exitCode: session.browserProcess.exitCode,
        profileGone,
        closeMs: Date.now() - started,
        args: session.args,
      })
    );
  }
}
