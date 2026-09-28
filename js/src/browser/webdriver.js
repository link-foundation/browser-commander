/**
 * Launching and connecting WebDriver sessions for the selenium engine
 * (issue #104).
 *
 * `launchWebDriver()` starts a driver server (chromedriver or geckodriver)
 * itself instead of letting selenium-webdriver do it, for the same reasons the
 * real-browser launcher owns Chrome's command line (issues #101, #103):
 *
 * - The driver is found the way a person would find it: the `driverPath` they
 *   gave, then PATH, then Selenium Manager (`--browser <name> --output json`),
 *   which downloads a driver matching the installed browser.
 * - The server runs on a reserved loopback port through command-stream like
 *   every other subprocess, and is ready when `GET /status` says so.
 * - Chrome gets a clean command line. chromedriver adds twenty switches of
 *   its own, including `--enable-automation` and `--remote-debugging-port=0`,
 *   each of which turns `navigator.webdriver` on. They are all excluded and
 *   Chrome gets a fixed debugging port instead, which measured
 *   `navigator.webdriver === false` (limitation
 *   `webdriver-driver-launch-switches`, experiments/issue-104/).
 *
 * `connectWebDriver()` attaches to a server that is already running, such as
 * a Selenium Grid.
 */

import { access, constants } from 'node:fs';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';

import { createWebDriverPage } from '../core/webdriver-page.js';
import {
  runCommand as defaultRunCommand,
  startProcess as defaultStartProcess,
} from '../utilities/subprocess.js';
import { LOOPBACK_HOST, reserveLoopbackPort } from './debugging-port.js';
import {
  createTemporaryUserDataDir,
  prepareUserDataDir,
  removeUserDataDir,
} from './profile-directory.js';
import { buildRealBrowserArgs } from './real-browser.js';
import { resolveRestrictions } from './restrictions.js';

const require = createRequire(import.meta.url);
const accessAsync = promisify(access);

/**
 * Switches chromedriver adds to Chrome's command line on its own, measured
 * from `chrome://version` with Chrome and chromedriver 153. All of them are
 * excluded; `--remote-debugging-port=0` is replaced by a fixed port instead
 * (chromedriver needs a port to attach, and port 0 is an AutomationControlled
 * trigger).
 */
export const CHROMEDRIVER_DEFAULT_SWITCHES = Object.freeze([
  'allow-pre-commit-input',
  'disable-background-networking',
  'disable-background-timer-throttling',
  'disable-backgrounding-occluded-windows',
  'disable-client-side-phishing-detection',
  'disable-default-apps',
  'disable-features',
  'disable-hang-monitor',
  'disable-popup-blocking',
  'disable-prompt-on-repost',
  'disable-sync',
  'enable-automation',
  'enable-logging',
  'log-level',
  'no-first-run',
  'no-service-autorun',
  'password-store',
  'test-type',
  'use-mock-keychain',
]);

const DRIVERS = Object.freeze({
  chrome: { name: 'chromedriver', builder: 'chrome' },
  firefox: { name: 'geckodriver', builder: 'firefox' },
});

/**
 * Load selenium-webdriver, an optional peer dependency.
 *
 * @param {string} [subpath] - e.g. 'chrome' for selenium-webdriver/chrome
 * @returns {Object}
 */
export function loadSelenium(subpath) {
  const id = subpath ? `selenium-webdriver/${subpath}` : 'selenium-webdriver';
  try {
    return require(id);
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'The selenium engine needs the selenium-webdriver package: npm install selenium-webdriver',
        { cause: error }
      );
    }
    throw error;
  }
}

function assertBrowser(browser) {
  if (!DRIVERS[browser]) {
    throw new Error(
      `Unsupported WebDriver browser: ${browser}. Expected 'chrome' or 'firefox'`
    );
  }
  return DRIVERS[browser];
}

/**
 * The Selenium Manager binary shipped with selenium-webdriver (or
 * `SE_MANAGER_PATH`), mirroring selenium-webdriver's own lookup.
 *
 * @param {Object} [options]
 * @returns {string}
 */
export function seleniumManagerPath({
  platform = process.platform,
  arch = process.arch,
  environment = process.env,
} = {}) {
  if (environment.SE_MANAGER_PATH) {
    return environment.SE_MANAGER_PATH;
  }
  const directory = {
    darwin: 'macos',
    win32: 'windows',
    cygwin: 'windows',
    linux: arch === 'arm64' ? 'linux-arm64' : 'linux-x86_64',
  }[platform];
  const file =
    directory === 'windows' ? 'selenium-manager.exe' : 'selenium-manager';
  const packageRoot = path.dirname(
    require.resolve('selenium-webdriver/package.json')
  );
  return path.join(packageRoot, 'bin', directory ?? platform, file);
}

async function isExecutable(file, checkAccess) {
  try {
    await checkAccess(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(name, { environment, platform, checkAccess }) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const file = platform === 'win32' ? `${name}.exe` : name;
  for (const directory of (environment.PATH ?? '').split(paths.delimiter)) {
    if (
      directory &&
      (await isExecutable(paths.join(directory, file), checkAccess))
    ) {
      return paths.join(directory, file);
    }
  }
  return null;
}

/**
 * Find the driver server for a browser: `driverPath`, then PATH, then
 * Selenium Manager.
 *
 * @param {Object} options
 * @param {'chrome'|'firefox'} [options.browser='chrome']
 * @param {string} [options.driverPath] - Explicit driver executable
 * @param {string} [options.executablePath] - Browser the driver must match
 * @param {Function} [options.runCommand] - command-stream runner (tests)
 * @returns {Promise<{driverPath: string, browserPath: (string|null), source: string}>}
 */
export async function resolveWebDriverExecutable({
  browser = 'chrome',
  driverPath,
  executablePath,
  environment = process.env,
  platform = process.platform,
  runCommand = defaultRunCommand,
  checkAccess = accessAsync,
  managerPath,
} = {}) {
  const { name } = assertBrowser(browser);
  if (driverPath) {
    if (!(await isExecutable(driverPath, checkAccess))) {
      throw new Error(`WebDriver executable is not accessible: ${driverPath}`);
    }
    return {
      driverPath,
      browserPath: executablePath ?? null,
      source: 'driverPath',
    };
  }

  const onPath = await findOnPath(name, { environment, platform, checkAccess });
  if (onPath) {
    return {
      driverPath: onPath,
      browserPath: executablePath ?? null,
      source: 'PATH',
    };
  }

  const manager = managerPath ?? seleniumManagerPath({ platform, environment });
  const args = ['--browser', browser, '--output', 'json'];
  if (executablePath) {
    args.push('--browser-path', executablePath);
  }
  const { stdout, code } = await runCommand(manager, args, { check: false });
  let output;
  try {
    output = JSON.parse(stdout);
  } catch {
    throw new Error(
      `Selenium Manager did not return JSON for ${name} (exit code ${code})`
    );
  }
  const result = output?.result ?? {};
  if (code !== 0 || !result.driver_path) {
    throw new Error(
      `Could not find ${name}: not on PATH, and Selenium Manager failed: ${result.message ?? `exit code ${code}`}. Pass driverPath.`
    );
  }
  return {
    driverPath: result.driver_path,
    browserPath: executablePath ?? result.browser_path ?? null,
    source: 'selenium-manager',
  };
}

/**
 * Command-line arguments for a driver server listening on `port`.
 *
 * @param {'chrome'|'firefox'} browser
 * @param {number} port
 * @returns {string[]}
 */
export function buildDriverServerArgs(browser, port) {
  if (assertBrowser(browser).name === 'geckodriver') {
    return ['--port', String(port), '--host', LOOPBACK_HOST];
  }
  return [`--port=${port}`];
}

/**
 * Poll `GET /status` until the driver reports `ready`.
 *
 * @param {string} serverUrl
 * @param {Object} options
 * @returns {Promise<void>}
 */
export async function waitForDriverReady(
  serverUrl,
  { fetchImplementation = fetch, timeout = 30_000, driverProcess, output } = {}
) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (
      driverProcess?.exitCode !== null &&
      driverProcess?.exitCode !== undefined
    ) {
      throw new Error(
        `WebDriver server exited with code ${driverProcess.exitCode} before it was ready${output?.() ? `: ${output().trim()}` : ''}`
      );
    }
    try {
      const response = await fetchImplementation(`${serverUrl}/status`);
      if (response.ok) {
        const status = await response.json();
        if (status?.value?.ready) {
          return;
        }
      }
    } catch {
      // Not listening yet.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `WebDriver server at ${serverUrl} was not ready within ${timeout}ms`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Browser options for a launch: Chrome with the real-browser command line and
 * chromedriver's own switches excluded, or Firefox with a dedicated profile.
 *
 * @param {Object} options
 * @returns {{options: Object, args: string[]}} selenium Options and the browser arguments
 */
export function buildBrowserOptions({
  selenium,
  browser,
  browserPath,
  userDataDir,
  remoteDebuggingPort,
  headless,
  restrictions,
  args,
  automationParity,
  bidi,
}) {
  let options;
  let browserArgs;
  if (browser === 'chrome') {
    options = new selenium.chrome.Options();
    browserArgs = buildRealBrowserArgs({
      userDataDir,
      remoteDebuggingPort,
      headless,
      restrictions,
      args,
      automationParity,
    });
    options.addArguments(...browserArgs);
    options.excludeSwitches(...CHROMEDRIVER_DEFAULT_SWITCHES);
    if (browserPath) {
      options.setChromeBinaryPath(browserPath);
    }
  } else {
    options = new selenium.firefox.Options();
    browserArgs = [
      '-profile',
      userDataDir,
      ...(headless ? ['-headless'] : []),
      ...args,
    ];
    options.addArguments(...browserArgs);
    if (browserPath) {
      options.setBinary(browserPath);
    }
  }
  if (bidi) {
    options.set('webSocketUrl', true);
    // BiDi reports prompts as events and the page handles them (the dialog
    // manager dismisses unhandled ones), so the driver must not close them
    // first.
    options.set('unhandledPromptBehavior', 'ignore');
  }
  return { options, args: browserArgs };
}

function seleniumModules(dependencies) {
  return (
    dependencies.selenium ?? {
      webdriver: loadSelenium(),
      chrome: loadSelenium('chrome'),
      firefox: loadSelenium('firefox'),
    }
  );
}

function resolveProfile(browser, userDataDir) {
  if (!userDataDir) {
    return createTemporaryUserDataDir();
  }
  // Chrome's profile gets the same preparation as a real-browser launch
  // (translate prompts off); Firefox uses the directory as given.
  return browser === 'chrome'
    ? prepareUserDataDir(userDataDir)
    : Promise.resolve(userDataDir);
}

// The driver passes its environment on to the browser, so restriction
// variables (launch-restrictions.json) go to the driver process.
function driverEnvironment(restrictions, env) {
  const restrictionEnv = resolveRestrictions(restrictions).env;
  if (!env && Object.keys(restrictionEnv).length === 0) {
    return undefined;
  }
  return { ...process.env, ...restrictionEnv, ...env };
}

function buildSession({ selenium, serverUrl, browser, options }) {
  const builder = new selenium.webdriver.Builder()
    .usingServer(serverUrl)
    .forBrowser(DRIVERS[browser].builder);
  if (browser === 'chrome') {
    builder.setChromeOptions(options);
  } else {
    builder.setFirefoxOptions(options);
  }
  return builder.build();
}

/**
 * Wrap a no-argument async function so every call shares the first result.
 * @param {function(): Promise<void>} fn
 * @returns {function(): Promise<void>}
 */
function memoize(fn) {
  let result;
  return () => (result ??= fn());
}

/**
 * Stop whatever part of a WebDriver session exists, ignoring failures of
 * pieces that are already gone: the page's BiDi subscriptions, the session,
 * the driver server and a temporary profile.
 */
async function teardown({
  page,
  driver,
  driverProcess,
  temporaryProfile = false,
  userDataDir,
}) {
  await page?.dispose().catch(() => {});
  await driver?.quit().catch(() => {});
  driverProcess?.kill();
  await driverProcess?.exited?.catch(() => {});
  if (temporaryProfile) {
    await removeUserDataDir(userDataDir);
  }
}

/**
 * Launch a browser under a WebDriver server this process starts and owns.
 *
 * @param {Object} [options]
 * @param {'chrome'|'firefox'} [options.browser='chrome']
 * @param {string} [options.executablePath] - Browser executable
 * @param {string} [options.driverPath] - chromedriver/geckodriver executable
 * @param {boolean} [options.headless=false]
 * @param {string} [options.userDataDir] - Profile directory; a temporary one is created (and removed on close) when omitted
 * @param {boolean} [options.bidi=false] - Enable WebDriver BiDi (events, preload scripts, full-page screenshots)
 * @param {string[]} [options.args] - Extra browser arguments
 * @param {string[]} [options.restrictions] - Chrome launch restrictions (launch-restrictions.json)
 * @param {boolean} [options.automationParity=true] - Keep navigator.webdriver false in headless Chrome
 * @param {Object<string,string>} [options.env] - Extra environment for the driver and browser
 * @param {number} [options.startupTimeout=30000]
 * @param {boolean} [options.verbose=false] - Mirror the driver server's output
 * @param {Object} [dependencies] - Injected selenium modules, runCommand, startProcess, fetch, reservePort, environment, platform (tests)
 * @returns {Promise<{driver: Object, page: Object, close: function(): Promise<void>, serverUrl: string, driverProcess: Object, driverPath: string, driverSource: string, browser: string, userDataDir: string, temporaryProfile: boolean, args: Array<string>, bidi: boolean}>}
 */
export async function launchWebDriver(options = {}, dependencies = {}) {
  const {
    browser = 'chrome',
    executablePath,
    driverPath: requestedDriverPath,
    headless = false,
    userDataDir: requestedUserDataDir,
    bidi = false,
    args = [],
    restrictions = [],
    automationParity = true,
    env,
    startupTimeout = 30_000,
    verbose = false,
  } = options;
  assertBrowser(browser);
  if (browser === 'firefox' && restrictions.length > 0) {
    throw new Error(
      'Launch restrictions are Chrome switches; not available for firefox'
    );
  }

  const selenium = seleniumModules(dependencies);
  const reservePort = dependencies.reservePort ?? reserveLoopbackPort;
  const startProcess = dependencies.startProcess ?? defaultStartProcess;

  const resolved = await resolveWebDriverExecutable({
    browser,
    driverPath: requestedDriverPath,
    executablePath,
    runCommand: dependencies.runCommand ?? defaultRunCommand,
    ...(dependencies.checkAccess
      ? { checkAccess: dependencies.checkAccess }
      : {}),
    ...(dependencies.environment
      ? { environment: dependencies.environment }
      : {}),
    ...(dependencies.platform ? { platform: dependencies.platform } : {}),
  });

  const temporaryProfile = !requestedUserDataDir;
  const userDataDir = await resolveProfile(browser, requestedUserDataDir);
  const childEnv = driverEnvironment(restrictions, env);

  let driverProcess;
  let driver;
  try {
    const port = await reservePort();
    const serverUrl = `http://${LOOPBACK_HOST}:${port}`;
    driverProcess = startProcess(
      resolved.driverPath,
      buildDriverServerArgs(browser, port),
      { env: childEnv, forwardOutput: verbose }
    );
    let output = '';
    driverProcess.stderr?.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(-4000);
    });
    await waitForDriverReady(serverUrl, {
      fetchImplementation: dependencies.fetch ?? fetch,
      timeout: startupTimeout,
      driverProcess,
      output: () => output,
    });

    const built = buildBrowserOptions({
      selenium,
      browser,
      browserPath: resolved.browserPath,
      userDataDir,
      remoteDebuggingPort:
        browser === 'chrome' ? await reservePort() : undefined,
      headless,
      restrictions,
      args,
      automationParity,
      bidi,
    });
    driver = await buildSession({
      selenium,
      serverUrl,
      browser,
      options: built.options,
    });
    const page = await createWebDriverPage(driver, dependencies.pageOptions);

    const close = memoize(() =>
      teardown({ page, driver, driverProcess, temporaryProfile, userDataDir })
    );

    return {
      driver,
      page,
      close,
      serverUrl,
      driverProcess,
      driverPath: resolved.driverPath,
      driverSource: resolved.source,
      browser,
      userDataDir,
      temporaryProfile,
      args: built.args,
      bidi,
    };
  } catch (error) {
    await teardown({ driver, driverProcess, temporaryProfile, userDataDir });
    throw error;
  }
}

/**
 * Open a session on a WebDriver server that is already running (a driver
 * started elsewhere, a Selenium Grid, a cloud provider).
 *
 * @param {Object} options
 * @param {string} options.serverUrl - e.g. 'http://127.0.0.1:4444'
 * @param {Object} [options.capabilities] - W3C capabilities; `browserName` defaults to 'chrome'. Set `webSocketUrl: true` for BiDi.
 * @param {Object} [dependencies] - Injected selenium modules (tests)
 * @returns {Promise<{driver: Object, page: Object, close: function(): Promise<void>, serverUrl: string}>}
 */
export async function connectWebDriver(options = {}, dependencies = {}) {
  const { serverUrl, capabilities = {} } = options;
  if (!serverUrl) {
    throw new Error('serverUrl is required to connect to a WebDriver server');
  }
  const { webdriver } = dependencies.selenium ?? { webdriver: loadSelenium() };
  const driver = await new webdriver.Builder()
    .usingServer(serverUrl)
    .withCapabilities({ browserName: 'chrome', ...capabilities })
    .build();
  const page = await createWebDriverPage(driver, dependencies.pageOptions);
  const close = memoize(() => teardown({ page, driver }));
  return { driver, page, close, serverUrl };
}
