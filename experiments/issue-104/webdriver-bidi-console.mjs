// Experiment (#104): does chromedriver's BiDi (webSocketUrl: true) still work
// with every chromedriver default switch excluded and a fixed debugging port,
// and does printPage work in a headful Chrome?
// Usage: xvfb-run -a node experiments/issue-104/webdriver-bidi-console.mjs
//        (HEADLESS=true for a headless run)
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const { Domain } = require('selenium-webdriver/bidi/domain');

const headless = process.env.HEADLESS === 'true';
const options = new chrome.Options();
options.setChromeBinaryPath(process.env.CHROME_PATH ?? '/usr/bin/google-chrome');
options.addArguments('--remote-debugging-port=9555');
if (headless) {
  options.addArguments('--headless=new');
}
options.excludeSwitches('enable-automation', 'test-type', 'enable-logging');
options.enableBidi();
const driver = await new Builder()
  .forBrowser('chrome')
  .setChromeOptions(options)
  .build();
try {
  const bidi = await Domain.connect(driver);
  const events = [];
  await bidi.addCallback('log.entryAdded', (params) =>
    events.push(['log', params.text])
  );
  await bidi.addCallback('browsingContext.load', (params) =>
    events.push(['load', params.url])
  );
  await driver.get('data:text/html,<script>console.log("hello bidi")</script>');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const webdriver = await driver.executeScript('return navigator.webdriver');
  let pdfBytes = null;
  try {
    pdfBytes = Buffer.from(await driver.printPage(), 'base64').length;
  } catch (error) {
    pdfBytes = `error: ${error.message.split('\n')[0]}`;
  }
  console.log(JSON.stringify({ headless, webdriver, events, pdfBytes }));
} finally {
  await driver.quit();
}
