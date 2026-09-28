// Lists the targets Puppeteer sees right after attaching to a real browser and
// the visibility of each, to find which tab is the one on screen.
// Usage: xvfb-run -a node experiments/issue-105/puppeteer-pages.mjs
import { launchRealBrowser } from '../../js/src/browser/real-browser.js';

const session = await launchRealBrowser({
  engine: process.env.ENGINE ?? 'puppeteer',
});
try {
  const browser = session.browser;
  const targets = browser.targets
    ? browser.targets().map((t) => [t.type(), t.url()])
    : [];
  console.log('targets', JSON.stringify(targets));
  const pages = browser.pages
    ? await browser.pages()
    : browser.contexts()[0].pages();
  for (const page of pages) {
    console.log(
      'page',
      page.url(),
      await page.evaluate(() => document.visibilityState)
    );
  }
  console.log(
    'chosen',
    session.page.url(),
    await session.page.evaluate(() => document.visibilityState)
  );
  await new Promise((r) => setTimeout(r, 1500));
  const later = browser.targets
    ? browser.targets().map((t) => [t.type(), t.url()])
    : [];
  console.log('targets later', JSON.stringify(later));
} finally {
  await session.close();
}
