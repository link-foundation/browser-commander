// Resolve the CI driver through the existing command-stream-backed lookup.
import { resolveWebDriverExecutable } from '../../js/src/browser/webdriver.js';

const { driverPath, browserPath } = await resolveWebDriverExecutable({
  browser: process.env.WEBDRIVER_BROWSER ?? 'chrome',
  executablePath: process.env.WEBDRIVER_BROWSER_PATH ?? process.env.CHROME_PATH,
});
process.stdout.write(`WEBDRIVER_PATH=${driverPath}\n`);
process.stdout.write(`WEBDRIVER_BROWSER_PATH=${browserPath}\n`);
