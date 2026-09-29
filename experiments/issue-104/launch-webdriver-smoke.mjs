// Smoke test for launchWebDriver() + makeBrowserCommander() on the selenium
// engine (issue #104). Run from the repository root:
//   xvfb-run -a node experiments/issue-104/launch-webdriver-smoke.mjs [--headless] [--bidi]
import { launchWebDriver, makeBrowserCommander } from '../../js/src/index.js';

const headless = process.argv.includes('--headless');
const bidi = process.argv.includes('--bidi');
const session = await launchWebDriver({
  browser: 'chrome',
  headless,
  bidi,
  executablePath: process.env.CHROME_PATH,
});
try {
  console.log('driver:', session.driverPath, `(${session.driverSource})`);
  console.log('server:', session.serverUrl);
  const commander = makeBrowserCommander({ page: session.page });
  console.log('engine:', commander.engine);
  const messages = [];
  if (bidi) {
    session.page.on('console', (message) => messages.push(message.text()));
    await session.page.eventsReady();
  }
  await commander.goto({
    url: "data:text/html,<title>t</title><input id=q><button id=b onclick=\"document.title='clicked';console.log('hi')\">b</button>",
  });
  await commander.fillTextArea({ selector: '#q', text: 'hello' });
  await commander.clickButton({ selector: '#b' });
  console.log('title:', await session.page.title());
  console.log('value:', await session.page.$eval('#q', (el) => el.value));
  console.log(
    'navigator.webdriver:',
    await session.page.evaluate(() => navigator.webdriver)
  );
  const pdf = await session.page.pdf();
  console.log('pdf bytes:', pdf.length);
  await new Promise((resolve) => setTimeout(resolve, 300));
  console.log('console messages:', messages);
  await commander.destroy?.();
} finally {
  await session.close();
}
