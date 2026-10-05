/** Native Selenium through the same JavaScript API as Playwright/Puppeteer. */
import { launchBrowser, makeBrowserCommander } from '../js/src/index.js';

const session = await launchBrowser({
  engine: 'selenium',
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
  args: process.env.CHROME_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
});
const commander = makeBrowserCommander({
  page: session.page,
  enableNetworkTracking: false,
  enableNavigationManager: false,
});
try {
  await commander.goto({
    url: 'data:text/html,<title>Selenium common API</title><input id="name">',
  });
  await commander.fill({ selector: '#name', text: 'Ada' });
  console.log(await commander.inputValue({ selector: '#name' }));
  console.log(await session.driver.getTitle());
} finally {
  await commander.destroy();
  await session.close();
}
