import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findBrowserSource } from './browser-sources.js';

import { startProcess } from '../utilities/subprocess.js';
import {
  applyAutomationParityArgs,
  detectAutomationControlledTriggers,
} from '../fingerprint/automation-parity.js';
import {
  prepareSnapshotLaunch,
  validateAttachOption,
} from './attach/snapshot-launch.js';
import { connectBrowser } from './connector.js';
import { migrateProfile } from './migration/index.js';
import {
  assertFixedDebuggingPort,
  classifyDevToolsOwnership,
  LOOPBACK_HOST,
  PortRaceError,
  reserveLoopbackPort,
  watchDevToolsOutput,
} from './debugging-port.js';
import {
  configureUserDataDir,
  createTemporaryUserDataDir,
  prepareUserDataDir,
  removeUserDataDir,
} from './profile-directory.js';
import {
  assertStringArray,
  mergeFeatureSwitches,
  resolveRestrictions,
} from './restrictions.js';
import {
  assertDedicatedUserDataDir,
  defaultUserDataDir,
  knownDefaultUserDataDirs,
  resolveSystemBrowserExecutable,
} from './system-browser.js';

/**
 * Switches the launcher owns. Letting a caller pass them would break the
 * guarantees of this path: DevTools bound to loopback only, a dedicated
 * profile, and no switch that turns AutomationControlled on (issue #101).
 */
const MANAGED_ARGUMENTS = [
  '--remote-debugging-address',
  '--remote-debugging-port',
  '--remote-debugging-pipe',
  '--user-data-dir',
];

/**
 * The page a real launch opens when the caller passes no start URL.
 *
 * With no URL at all a browser opens its start pages instead: Chrome the New
 * Tab page, Edge the MSN New Tab page and edge://welcome-new-profile, whose
 * flow closes the window - and so ends the browser - a few seconds after the
 * launch. Playwright and Puppeteer open about:blank for the same reason. The
 * URL is not a switch, and a page cannot see how its tab was first opened.
 */
const START_URL = 'about:blank';

/**
 * Build the command line for a real browser.
 *
 * By default it is exactly what a person would type to allow a debugger:
 * `--user-data-dir=<dir> --remote-debugging-port=<port> about:blank` (issue
 * #103), and a start URL among the custom `args` replaces `about:blank`. The
 * fixed port keeps `navigator.webdriver` false without any extra switch
 * (issue #101). Everything else is opt-in: `headless`, named `restrictions`
 * and custom `args`.
 *
 * Chrome's DevTools server binds to loopback by default, so no
 * `--remote-debugging-address` is passed; the switch stays managed so custom
 * arguments cannot expose DevTools on another interface.
 *
 * `--headless` is not an AutomationControlled trigger (a hand-started headless
 * Chrome reports `navigator.webdriver === false`), so a headless launch gets
 * no off switch either. Only when a custom argument is a trigger is the off
 * switch added, unless `automationParity` is false.
 *
 * @param {Object} options
 * @param {string} options.userDataDir - Dedicated profile directory
 * @param {number} options.remoteDebuggingPort - Fixed loopback port, 1-65535
 * @param {boolean} [options.headless=false]
 * @param {string[]} [options.restrictions] - Names from launch-restrictions.json
 * @param {string[]} [options.args] - Additional switches
 * @param {string[]} [options.extraArgs] - Additional switches appended after args
 * @param {boolean} [options.automationParity=true]
 * @returns {string[]}
 */
export function buildRealBrowserArgs({
  userDataDir,
  remoteDebuggingPort,
  headless = false,
  restrictions = [],
  args = [],
  extraArgs = [],
  automationParity = true,
}) {
  assertFixedDebuggingPort(remoteDebuggingPort);
  const customArgs = [
    ...assertStringArray(args, 'args'),
    ...assertStringArray(extraArgs, 'extraArgs'),
  ];
  const conflictingArgument = customArgs.find((argument) =>
    MANAGED_ARGUMENTS.some(
      (managed) => argument === managed || argument.startsWith(`${managed}=`)
    )
  );
  if (conflictingArgument) {
    throw new Error(
      `${conflictingArgument} is managed by launchAndConnectRealBrowser`
    );
  }

  let browserArgs = mergeFeatureSwitches([
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${remoteDebuggingPort}`,
    ...(headless ? ['--headless=new'] : []),
    ...resolveRestrictions(restrictions).args,
    ...customArgs,
  ]);
  if (
    automationParity &&
    detectAutomationControlledTriggers(browserArgs).length > 0
  ) {
    browserArgs = applyAutomationParityArgs(browserArgs);
  }
  if (browserArgs.every((argument) => argument.startsWith('-'))) {
    browserArgs.push(START_URL);
  }
  return browserArgs;
}

async function fetchCdpVersion(endpoint, fetchImplementation, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeout, 500));
  try {
    const response = await fetchImplementation(`${endpoint}/json/version`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const version = await response.json();
    return version.webSocketDebuggerUrl ? version : null;
  } finally {
    clearTimeout(timer);
  }
}

async function readDevToolsActivePort(userDataDir) {
  try {
    const content = await readFile(
      path.join(userDataDir, 'DevToolsActivePort'),
      'utf8'
    );
    const [port, browserPath] = content.split(/\r?\n/);
    return { port: Number.parseInt(port, 10), browserPath };
  } catch {
    return null;
  }
}

/**
 * Wait until the browser we spawned publishes its DevTools endpoint on the
 * reserved port, and prove that the endpoint belongs to it.
 *
 * Proof comes from the browser's own stderr (`DevTools listening on
 * ws://127.0.0.1:<port>/devtools/browser/<id>`), whose browser id must match
 * the `webSocketDebuggerUrl` served on the port. Chrome writes
 * `DevToolsActivePort` only for port 0, so the file is accepted as proof when
 * present (for callers that bring their own spawn) but never required.
 *
 * @throws {PortRaceError} When another process holds the port
 */
export async function waitForCdpEndpoint({
  remoteDebuggingPort,
  userDataDir,
  browserProcess,
  devToolsOutput = watchDevToolsOutput(browserProcess?.stderr),
  timeout = 30_000,
  fetchImplementation = globalThis.fetch,
}) {
  const port = assertFixedDebuggingPort(remoteDebuggingPort);
  const endpoint = `http://${LOOPBACK_HOST}:${port}`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const output = devToolsOutput.state();
    let ownership = devToolsOutput.available
      ? classifyDevToolsOwnership(output, port)
      : 'unknown';
    if (ownership === 'race') {
      throw new PortRaceError(port, output.listening?.url ?? 'bind failed');
    }
    if (browserProcess.exitCode !== null) {
      throw new Error(
        `Browser exited before its DevTools endpoint was ready (exit ${browserProcess.exitCode})`
      );
    }
    if (ownership !== 'owned') {
      const activePort = await readDevToolsActivePort(userDataDir);
      if (activePort?.port === port) {
        ownership = 'owned';
      }
    }

    if (ownership === 'owned') {
      let version = null;
      try {
        version = await fetchCdpVersion(
          endpoint,
          fetchImplementation,
          Math.max(1, deadline - Date.now())
        );
      } catch {
        // The HTTP handler can lag the listening line by a moment.
      }
      if (version) {
        const expected = output.listening?.url;
        if (expected && version.webSocketDebuggerUrl !== expected) {
          throw new PortRaceError(
            port,
            `port serves ${version.webSocketDebuggerUrl}, browser announced ${expected}`
          );
        }
        return endpoint;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out after ${timeout}ms waiting for the DevTools endpoint on port ${port}`
  );
}

function spawnWithStartProcess(executablePath, args, { env, verbose }) {
  return startProcess(executablePath, args, { env, forwardOutput: verbose });
}

async function waitForExit(browserProcess, timeout) {
  if (browserProcess.exitCode !== null) {
    return true;
  }
  if (typeof browserProcess.once !== 'function') {
    return false;
  }
  let timer;
  const exited = await Promise.race([
    new Promise((resolve) => browserProcess.once('exit', () => resolve(true))),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeout);
    }),
  ]);
  clearTimeout(timer);
  return exited;
}

async function requestBrowserClose({ engine, browser, originalClose }) {
  if (engine === 'puppeteer') {
    // A connected Puppeteer Browser sends Browser.close and waits for it.
    await originalClose.call(browser);
    return;
  }
  // Playwright's close() only disconnects from a connectOverCDP browser, so
  // ask Chrome itself to shut down, then drop the connection.
  const session = await browser.newBrowserCDPSession();
  await session.send('Browser.close').catch(() => {});
  await originalClose.call(browser).catch(() => {});
}

function createCloser({
  engine,
  browser,
  browserProcess,
  userDataDir,
  temporaryProfile,
  closeTimeout,
}) {
  const originalClose = browser?.close;
  let closing;
  const close = () => {
    closing ??= (async () => {
      if (browserProcess.exitCode === null && originalClose) {
        await requestBrowserClose({ engine, browser, originalClose }).catch(
          () => {}
        );
      }
      if (!(await waitForExit(browserProcess, closeTimeout))) {
        browserProcess.kill();
        await waitForExit(browserProcess, closeTimeout);
      }
      if (temporaryProfile) {
        await removeUserDataDir(userDataDir);
      }
    })();
    return closing;
  };
  if (browser && originalClose) {
    // `browser.close()` means "close the browser" for every caller, so it
    // shuts the spawned process down and deletes a temporary profile too.
    browser.close = close;
  }
  return close;
}

/**
 * Spawn a genuine installed Chrome-family browser with a dedicated profile,
 * wait for its loopback CDP endpoint, and attach through {@link connectBrowser}.
 *
 * The command line is `--user-data-dir=<dir> --remote-debugging-port=<port>`
 * and nothing else unless asked for, so the session is as close to a
 * hand-started browser as CDP allows and `navigator.webdriver` is false.
 *
 * @param {Object} options - Launch and connection options
 * @param {'playwright'|'puppeteer'} [options.engine='playwright'] - Automation engine
 * @param {string} [options.channel='chrome'] - Installed Chrome-family channel
 * @param {string} [options.executablePath] - Explicit installed browser executable
 * @param {string} [options.userDataDir] - Persistent dedicated profile. When omitted a fresh temporary profile is created and deleted on close.
 * @param {number} [options.remoteDebuggingPort] - Fixed loopback CDP port. When omitted a free port is reserved (and re-reserved on a port race). Zero is refused because it sets navigator.webdriver.
 * @param {number} [options.portAttempts=3] - Launch attempts when a reserved port is lost to a race
 * @param {boolean} [options.headless=false] - Run the installed browser headlessly
 * @param {string[]} [options.restrictions] - Opt-in restrictions from launch-restrictions.json, such as 'no-extensions'
 * @param {string[]} [options.args] - Additional browser arguments
 * @param {string[]} [options.extraArgs] - Additional browser arguments appended after args
 * @param {boolean} [options.defaultBrowserCheck=false] - Allow the disposable browser to ask to become the default
 * @param {Object} [options.preferences] - Deep-merged into Default/Preferences before launch
 * @param {Object} [options.localState] - Deep-merged into Local State before launch
 * @param {Object<string,string>} [options.env] - Extra environment for the browser process only
 * @param {boolean} [options.automationParity=true] - Add the AutomationControlled off switch when a custom argument turns the feature on
 * @param {number} [options.startupTimeout=30000] - CDP readiness timeout in milliseconds
 * @param {number} [options.closeTimeout=5000] - How long close() waits before killing the process
 * @param {Object[]} [options.seedCookies] - Cookies to seed after connecting
 * @param {{browser: string, profile: (string|undefined), userDataDir: (string|undefined), include: (Array<string>|undefined), domains: (Array<string>|undefined)}} [options.migrateFrom] - Migrate a real browser profile into the dedicated profile before launch; on-disk data is written before the browser starts and cookies are seeded over CDP after connecting
 * @param {{mode: 'snapshot', browser: (string|undefined), profile: (string|undefined), userDataDir: (string|undefined)}} [options.attach] - Launch on a read-only snapshot of a real profile (issue #102, addendum): `snapshotUserDataDir()` copies it into a temporary user data directory, which is deleted on close. `browser` defaults to the channel's browser and `profile` to Default. Mutually exclusive with `migrateFrom` and `userDataDir`.
 * @param {boolean} [options.verbose=false] - Show browser and connection logs
 * @returns {Promise<{browser: Object, page: Object, downloads: (Object|null), close: function(): Promise<void>, browserProcess: Object, cdpEndpoint: string, remoteDebuggingPort: number, executablePath: string, userDataDir: string, temporaryProfile: boolean, args: Array<string>, migration: (Object|undefined), attach: ({mode: 'snapshot', snapshot: Object, differences: Array<{aspect: string, description: string}>}|undefined)}>} Connected handles and process metadata (with a `migration` report when `migrateFrom` was given and an `attach` entry when `attach` was given)
 */
export async function launchAndConnectRealBrowser(options = {}) {
  return await launchAndConnectRealBrowserWithDependencies(options);
}

/**
 * Short Playwright-style name for {@link launchAndConnectRealBrowser}.
 *
 * Both names are the same function so existing callers can keep using the
 * descriptive name while new code can use the API proposed for real-browser
 * launch.
 */
export const launchRealBrowser = launchAndConnectRealBrowser;

async function spawnOnFreePort({
  requestedPort,
  portAttempts,
  executablePath,
  argOptions,
  env,
  verbose,
  userDataDir,
  startupTimeout,
  dependencies,
}) {
  const reservePort = dependencies.reservePort ?? reserveLoopbackPort;
  const spawnBrowser = dependencies.spawnBrowser ?? spawnWithStartProcess;
  const waitForEndpoint = dependencies.waitForEndpoint ?? waitForCdpEndpoint;
  const attempts = requestedPort === undefined ? portAttempts : 1;
  for (let attempt = 1; ; attempt++) {
    const port = requestedPort ?? (await reservePort());
    const browserArgs = buildRealBrowserArgs({
      ...argOptions,
      userDataDir,
      remoteDebuggingPort: port,
    });
    const browserProcess = spawnBrowser(executablePath, browserArgs, {
      env,
      verbose,
    });
    try {
      const cdpEndpoint = await waitForEndpoint({
        remoteDebuggingPort: port,
        userDataDir,
        browserProcess,
        timeout: startupTimeout,
      });
      return { browserProcess, cdpEndpoint, port, browserArgs };
    } catch (error) {
      if (browserProcess.exitCode === null) {
        browserProcess.kill();
      }
      if (!(error instanceof PortRaceError) || attempt >= attempts) {
        throw error;
      }
      if (verbose) {
        console.log(`${error.message}; retrying with a new port`);
      }
      await waitForExit(browserProcess, 5_000);
    }
  }
}

/** Reject a launch request before anything touches the disk. */
function validateLaunchRequest({
  argOptions,
  channel,
  userDataDir,
  remoteDebuggingPort,
  endpoint,
  attach,
  migrateFrom,
}) {
  const source = findBrowserSource(channel);
  if (source && source.family !== 'chromium') {
    throw new Error(
      `${channel} does not support CDP; use its documented WebDriver setup when available`
    );
  }
  if (endpoint) {
    throw new Error(
      'launchAndConnectRealBrowser creates its own endpoint; use connectBrowser to attach to an existing endpoint'
    );
  }
  validateAttachOption({
    attach,
    migrateFrom,
    userDataDir,
    customArgs: [argOptions.args, argOptions.extraArgs].flatMap((list) =>
      Array.isArray(list) ? list : []
    ),
  });
  if (remoteDebuggingPort !== undefined) {
    assertFixedDebuggingPort(remoteDebuggingPort);
  }
  buildRealBrowserArgs({
    ...argOptions,
    userDataDir: userDataDir ?? 'validation',
    remoteDebuggingPort: remoteDebuggingPort ?? 1,
  });
  if (userDataDir) {
    assertDedicatedUserDataDir(userDataDir);
  }
}

/**
 * Environment for the browser process. Restriction environment (for example
 * no-google-services) goes to the browser only; this process's environment is
 * never modified.
 */
function browserEnvironment(restrictions, env) {
  const restrictionEnv = resolveRestrictions(restrictions).env;
  return env || Object.keys(restrictionEnv).length > 0
    ? { ...process.env, ...restrictionEnv, ...env }
    : undefined;
}

/**
 * Create the profile the browser starts with: a snapshot of a real profile
 * for `attach`, a fresh temporary one, or the caller's dedicated one. A
 * snapshot is a temporary profile too and is deleted on close. The snapshot's
 * `--profile-directory` switch is put before the custom `args`.
 */
async function prepareProfile({
  attach,
  channel,
  requestedUserDataDir,
  argOptions,
  snapshot,
  firstRun,
}) {
  if (attach) {
    const snapshotLaunch = await prepareSnapshotLaunch({
      attach,
      channel,
      restrictions: argOptions.restrictions,
      customArgs: [...argOptions.args, ...argOptions.extraArgs],
      snapshot,
    });
    argOptions.args = [...snapshotLaunch.args, ...argOptions.args];
    return { userDataDir: snapshotLaunch.userDataDir, snapshotLaunch };
  }
  return {
    userDataDir: requestedUserDataDir
      ? await prepareUserDataDir(requestedUserDataDir, { firstRun })
      : await createTemporaryUserDataDir({ firstRun }),
  };
}

/** Dependency-injected implementation used by the public helper and tests. */
/**
 * Migrate a real browser profile into the dedicated profile before launch.
 *
 * On-disk data classes (bookmarks, history, passwords, preferences,
 * extensions) must be in place before the browser starts, so this runs before
 * the process is spawned. Cookies are returned instead of written because a
 * running Chromium re-derives its own encryption; the caller seeds them over
 * CDP after connecting. On failure a freshly created temporary profile is
 * removed before the error propagates.
 *
 * @returns {Promise<{migration: (Object|undefined), migratedCookies: Array<Object>}>}
 */
async function runPreLaunchMigration({
  migrateFrom,
  userDataDir,
  channel,
  temporaryProfile,
  migrate,
}) {
  if (!migrateFrom) {
    return { migration: undefined, migratedCookies: [] };
  }
  const { include, domains, passwordCsv, includePaymentCards, ...from } =
    migrateFrom;
  try {
    const report = await migrate({
      from,
      to: path.join(userDataDir, 'Default'),
      include,
      domains,
      passwordCsv,
      includePaymentCards,
      targetBrowser: channel,
    });
    const { cookies, ...migration } = report;
    return { migration, migratedCookies: cookies ?? [] };
  } catch (error) {
    if (temporaryProfile) {
      await removeUserDataDir(userDataDir);
    }
    throw error;
  }
}

function mergeSeedCookies(seedCookies, migratedCookies) {
  return migratedCookies.length > 0
    ? [...(seedCookies ?? []), ...migratedCookies]
    : seedCookies;
}

// Runs a launch step and, if it throws, removes the profile this launch
// created before rethrowing. A caller-supplied profile is never removed.
async function removingTemporaryProfileOnError(
  { userDataDir, temporaryProfile },
  step
) {
  try {
    return await step();
  } catch (error) {
    if (temporaryProfile) {
      await removeUserDataDir(userDataDir);
    }
    throw error;
  }
}

export async function launchAndConnectRealBrowserWithDependencies(
  options = {},
  dependencies = {}
) {
  const {
    engine = 'playwright',
    channel = 'chrome',
    executablePath: requestedExecutablePath,
    userDataDir: requestedUserDataDir,
    remoteDebuggingPort,
    portAttempts = 3,
    headless = false,
    restrictions = [],
    args = [],
    extraArgs = [],
    ignoreDefaultArgs: _ignoredLegacyDefaults,
    env,
    automationParity = true,
    startupTimeout = 30_000,
    closeTimeout = 5_000,
    verbose = false,
    cdpEndpoint,
    wsEndpoint,
    migrateFrom,
    attach,
    defaultBrowserCheck,
    preferences,
    localState,
    firstRun,
    ...connectionOptions
  } = options;
  const argOptions = {
    headless,
    restrictions,
    args,
    extraArgs,
    automationParity,
  };
  validateLaunchRequest({
    argOptions,
    channel,
    userDataDir: requestedUserDataDir,
    remoteDebuggingPort,
    endpoint: cdpEndpoint || wsEndpoint,
    attach,
    migrateFrom,
  });

  const resolveExecutable =
    dependencies.resolveExecutable ?? resolveSystemBrowserExecutable;
  const executablePath = await resolveExecutable({
    channel,
    executablePath: requestedExecutablePath,
  });

  const temporaryProfile = !requestedUserDataDir;
  const { userDataDir, snapshotLaunch } = await prepareProfile({
    attach,
    channel,
    requestedUserDataDir,
    argOptions,
    snapshot: dependencies.snapshotUserDataDir,
    firstRun,
  });
  const childEnv = browserEnvironment(restrictions, env);

  const { migration, migratedCookies } = await runPreLaunchMigration({
    migrateFrom,
    userDataDir,
    channel,
    temporaryProfile,
    migrate: dependencies.migrateProfile ?? migrateProfile,
  });

  // Migration and snapshot attach can copy a preference that enables the
  // default-browser infobar, so apply launch settings after either copy.
  const profile = { userDataDir, temporaryProfile };
  await removingTemporaryProfileOnError(profile, () =>
    configureUserDataDir(userDataDir, {
      defaultBrowserCheck,
      preferences,
      localState,
      profileDirectory: attach?.profile ?? 'Default',
    })
  );

  const launched = await removingTemporaryProfileOnError(profile, () =>
    spawnOnFreePort({
      requestedPort: remoteDebuggingPort,
      portAttempts,
      executablePath,
      argOptions,
      env: childEnv,
      verbose,
      userDataDir,
      startupTimeout,
      dependencies,
    })
  );
  const { browserProcess, cdpEndpoint: resolvedCdpEndpoint } = launched;
  if (temporaryProfile) {
    // The profile goes away with the browser, also when the user closes the
    // window instead of the caller calling close().
    browserProcess.once?.('exit', () => {
      removeUserDataDir(userDataDir).catch(() => {});
    });
  }

  try {
    const connect = dependencies.connect ?? connectBrowser;
    const seedCookies = mergeSeedCookies(
      connectionOptions.seedCookies,
      migratedCookies
    );
    const connection = await connect({
      engine,
      cdpEndpoint: resolvedCdpEndpoint,
      ...connectionOptions,
      seedCookies,
      verbose,
    });
    const close = createCloser({
      engine,
      browser: connection.browser,
      browserProcess,
      userDataDir,
      temporaryProfile,
      closeTimeout,
    });
    return {
      ...connection,
      close,
      browserProcess,
      cdpEndpoint: resolvedCdpEndpoint,
      remoteDebuggingPort: launched.port,
      executablePath,
      userDataDir,
      temporaryProfile,
      args: launched.browserArgs,
      ...(migration ? { migration } : {}),
      ...(snapshotLaunch ? { attach: snapshotLaunch.attach } : {}),
    };
  } catch (error) {
    if (browserProcess.exitCode === null) {
      browserProcess.kill();
    }
    await waitForExit(browserProcess, closeTimeout);
    if (temporaryProfile) {
      await removeUserDataDir(userDataDir);
    }
    throw error;
  }
}

export {
  assertDedicatedUserDataDir,
  defaultUserDataDir,
  knownDefaultUserDataDirs,
  resolveSystemBrowserExecutable,
};
