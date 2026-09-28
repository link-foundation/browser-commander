// Measures document.visibilityState of the page launchRealBrowser hands out,
// before and after the first navigation, across several launches.
// Usage: xvfb-run -a node experiments/issue-105/puppeteer-visibility.mjs
import { launchRealBrowser } from '../../js/src/browser/real-browser.js';

for (let run = 0; run < Number(process.env.RUNS ?? 4); run++) {
  const session = await launchRealBrowser({
    engine: process.env.ENGINE ?? 'puppeteer',
  });
  try {
    const pages = await (session.browser.pages
      ? session.browser.pages()
      : session.browser.contexts()[0].pages());
    const states = await Promise.all(
      pages.map(
        async (p) =>
          `${p.url()}=${await p.evaluate(() => document.visibilityState).catch((e) => e.message)}`
      )
    );
    const before = await session.page.evaluate(() => document.visibilityState);
    await session.page.goto('data:text/html,<title>x</title>');
    const after = await session.page.evaluate(() => document.visibilityState);
    console.log(
      JSON.stringify({ run, chosen: session.page.url(), states, before, after })
    );
  } finally {
    await session.close();
  }
}
