import { launchWebDriver } from './webdriver.js';
import { findBrowserSource } from './browser-sources.js';
import { validateSafariOptions } from './safari-support.js';
import { restoreWebDriverStorageState } from './storage-state.js';

/** Launch installed Safari through its native W3C WebDriver server. */
export async function launchSafari(options = {}, dependencies = {}) {
  validateSafariOptions(options);
  const channel = findBrowserSource(
    options.channel ?? options.browser ?? 'safari'
  ).id;
  const launched = await (dependencies.launchWebDriver ?? launchWebDriver)(
    {
      ...options,
      browser: channel,
      driverPath: options.driverPath ?? options.executablePath,
      executablePath: undefined,
    },
    dependencies
  );
  try {
    const state = options.storageState;
    await restoreWebDriverStorageState({
      page: launched.page,
      storageState: state,
      seedCookies: options.seedCookies,
    });
  } catch (error) {
    await launched.close();
    throw error;
  }
  return {
    ...launched,
    browser: launched.driver,
    engine: 'selenium',
    controlProtocol: 'webdriver',
    executablePath: launched.driverPath,
    browserProcess: launched.driverProcess,
    downloads: null,
    launch: options.launch ?? 'real',
  };
}
