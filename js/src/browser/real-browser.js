import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { connectBrowser } from './connector.js';

const MANAGED_ARGUMENTS = [
  '--remote-debugging-address',
  '--remote-debugging-port',
  '--user-data-dir',
];

const CHANNEL_EXECUTABLE_NAMES = {
  brave: ['brave-browser', 'brave-browser-stable', 'brave'],
  chrome: ['google-chrome', 'google-chrome-stable', 'chrome'],
  'chrome-beta': ['google-chrome-beta'],
  'chrome-canary': ['google-chrome-canary'],
  'chrome-dev': ['google-chrome-unstable'],
  chromium: ['chromium', 'chromium-browser'],
  msedge: ['microsoft-edge', 'microsoft-edge-stable', 'msedge'],
  'msedge-beta': ['microsoft-edge-beta'],
  'msedge-canary': ['microsoft-edge-canary'],
  'msedge-dev': ['microsoft-edge-dev'],
};

function platformPath(platform) {
  return platform === 'win32' ? path.win32 : path;
}

function defaultUserDataDir(channel, homeDir = os.homedir()) {
  const directoryName = channel.replace(/[^a-z0-9_.-]/gi, '-');
  return path.join(
    homeDir,
    '.browser-commander',
    'real-browser',
    directoryName
  );
}

function knownDefaultUserDataDirs({
  platform = process.platform,
  homeDir = os.homedir(),
  environment = process.env,
} = {}) {
  const pathApi = platformPath(platform);
  if (platform === 'darwin') {
    const applicationSupport = pathApi.join(
      homeDir,
      'Library',
      'Application Support'
    );
    return [
      pathApi.join(applicationSupport, 'Google', 'Chrome'),
      pathApi.join(applicationSupport, 'Google', 'Chrome Beta'),
      pathApi.join(applicationSupport, 'Google', 'Chrome Canary'),
      pathApi.join(applicationSupport, 'Google', 'Chrome Dev'),
      pathApi.join(applicationSupport, 'Chromium'),
      pathApi.join(applicationSupport, 'BraveSoftware', 'Brave-Browser'),
      pathApi.join(applicationSupport, 'BraveSoftware', 'Brave-Browser-Beta'),
      pathApi.join(
        applicationSupport,
        'BraveSoftware',
        'Brave-Browser-Nightly'
      ),
      pathApi.join(applicationSupport, 'Microsoft Edge'),
      pathApi.join(applicationSupport, 'Microsoft Edge Beta'),
      pathApi.join(applicationSupport, 'Microsoft Edge Canary'),
      pathApi.join(applicationSupport, 'Microsoft Edge Dev'),
    ];
  }
  if (platform === 'win32') {
    const localAppData =
      environment.LOCALAPPDATA ?? pathApi.join(homeDir, 'AppData', 'Local');
    return [
      pathApi.join(localAppData, 'Google', 'Chrome', 'User Data'),
      pathApi.join(localAppData, 'Google', 'Chrome Beta', 'User Data'),
      pathApi.join(localAppData, 'Google', 'Chrome Dev', 'User Data'),
      pathApi.join(localAppData, 'Google', 'Chrome SxS', 'User Data'),
      pathApi.join(localAppData, 'Chromium', 'User Data'),
      pathApi.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      pathApi.join(
        localAppData,
        'BraveSoftware',
        'Brave-Browser-Beta',
        'User Data'
      ),
      pathApi.join(
        localAppData,
        'BraveSoftware',
        'Brave-Browser-Nightly',
        'User Data'
      ),
      pathApi.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      pathApi.join(localAppData, 'Microsoft', 'Edge Beta', 'User Data'),
      pathApi.join(localAppData, 'Microsoft', 'Edge Dev', 'User Data'),
      pathApi.join(localAppData, 'Microsoft', 'Edge SxS', 'User Data'),
    ];
  }
  return [
    pathApi.join(homeDir, '.config', 'google-chrome'),
    pathApi.join(homeDir, '.config', 'google-chrome-beta'),
    pathApi.join(homeDir, '.config', 'google-chrome-unstable'),
    pathApi.join(homeDir, '.config', 'chromium'),
    pathApi.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser'),
    pathApi.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser-Beta'),
    pathApi.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser-Nightly'),
    pathApi.join(homeDir, '.config', 'microsoft-edge'),
    pathApi.join(homeDir, '.config', 'microsoft-edge-beta'),
    pathApi.join(homeDir, '.config', 'microsoft-edge-dev'),
  ];
}

/** Ensure Chrome is not asked to expose the user's default profile over CDP. */
export function assertDedicatedUserDataDir(userDataDir, platformOptions = {}) {
  if (!userDataDir) {
    throw new Error('launchAndConnectRealBrowser requires a userDataDir');
  }
  const platform = platformOptions.platform ?? process.platform;
  const pathApi = platformPath(platform);
  const normalize = (value) => {
    const resolved = pathApi.resolve(value).replace(/[\\/]+$/, '');
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const requested = normalize(userDataDir);
  const isDefault = knownDefaultUserDataDirs(platformOptions).some(
    (directory) => normalize(directory) === requested
  );
  if (isDefault) {
    throw new Error(
      'launchAndConnectRealBrowser requires a dedicated userDataDir, not a browser default profile'
    );
  }
}

function browserInstallCandidates({
  channel,
  platform = process.platform,
  environment = process.env,
}) {
  const candidates = [];
  const names = CHANNEL_EXECUTABLE_NAMES[channel];
  if (!names) {
    throw new Error(
      `Unknown browser channel: ${channel}. Expected one of ${Object.keys(CHANNEL_EXECUTABLE_NAMES).join(', ')}`
    );
  }

  if (platform === 'darwin') {
    const applications = {
      brave: 'Brave Browser.app/Contents/MacOS/Brave Browser',
      chrome: 'Google Chrome.app/Contents/MacOS/Google Chrome',
      'chrome-beta': 'Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      'chrome-canary':
        'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      'chrome-dev': 'Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
      chromium: 'Chromium.app/Contents/MacOS/Chromium',
      msedge: 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'msedge-beta':
        'Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta',
      'msedge-canary':
        'Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary',
      'msedge-dev': 'Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev',
    };
    candidates.push(path.join('/Applications', applications[channel]));
  } else if (platform === 'win32') {
    const roots = [
      environment.PROGRAMFILES,
      environment['PROGRAMFILES(X86)'],
      environment.LOCALAPPDATA,
    ].filter(Boolean);
    const relativePaths = {
      brave: ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
      chrome: ['Google', 'Chrome', 'Application', 'chrome.exe'],
      'chrome-beta': ['Google', 'Chrome Beta', 'Application', 'chrome.exe'],
      'chrome-canary': ['Google', 'Chrome SxS', 'Application', 'chrome.exe'],
      'chrome-dev': ['Google', 'Chrome Dev', 'Application', 'chrome.exe'],
      chromium: ['Chromium', 'Application', 'chrome.exe'],
      msedge: ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
      'msedge-beta': ['Microsoft', 'Edge Beta', 'Application', 'msedge.exe'],
      'msedge-canary': ['Microsoft', 'Edge SxS', 'Application', 'msedge.exe'],
      'msedge-dev': ['Microsoft', 'Edge Dev', 'Application', 'msedge.exe'],
    };
    for (const root of roots) {
      candidates.push(path.win32.join(root, ...relativePaths[channel]));
    }
  } else {
    for (const name of names) {
      candidates.push(`/usr/bin/${name}`, `/usr/local/bin/${name}`);
    }
    if (channel === 'chrome') {
      candidates.push('/opt/google/chrome/google-chrome');
    }
  }

  const pathApi = platformPath(platform);
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  for (const directory of (environment.PATH ?? '').split(delimiter)) {
    if (!directory) {
      continue;
    }
    for (const name of names) {
      candidates.push(
        pathApi.join(directory, platform === 'win32' ? `${name}.exe` : name)
      );
    }
  }
  return [...new Set(candidates)];
}

/** Resolve a genuine installed Chrome-family browser executable. */
export async function resolveSystemBrowserExecutable({
  channel = 'chrome',
  executablePath,
  platform = process.platform,
  environment = process.env,
} = {}) {
  const candidates = executablePath
    ? [path.resolve(executablePath)]
    : browserInstallCandidates({ channel, platform, environment });
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through known locations and PATH entries.
    }
  }
  throw new Error(
    executablePath
      ? `Browser executable is not accessible: ${executablePath}`
      : `Could not find an installed ${channel} browser; provide executablePath`
  );
}

/** Build the protected command line used for a real browser CDP process. */
export function buildRealBrowserArgs({
  userDataDir,
  remoteDebuggingPort = 0,
  headless = false,
  args = [],
}) {
  if (
    !Number.isInteger(remoteDebuggingPort) ||
    remoteDebuggingPort < 0 ||
    remoteDebuggingPort > 65_535
  ) {
    throw new RangeError(
      'remoteDebuggingPort must be an integer from 0 to 65535'
    );
  }
  const conflictingArgument = args.find((argument) =>
    MANAGED_ARGUMENTS.some(
      (managed) => argument === managed || argument.startsWith(`${managed}=`)
    )
  );
  if (conflictingArgument) {
    throw new Error(
      `${conflictingArgument} is managed by launchAndConnectRealBrowser`
    );
  }

  return [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(headless ? ['--headless=new'] : []),
    ...args,
  ];
}

async function fetchCdpVersion(endpoint, fetchImplementation, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeout, 500));
  try {
    const response = await fetchImplementation(`${endpoint}/json/version`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return false;
    }
    const version = await response.json();
    return Boolean(version.webSocketDebuggerUrl);
  } finally {
    clearTimeout(timer);
  }
}

/** Wait until Chrome publishes a usable DevTools endpoint. */
export async function waitForCdpEndpoint({
  remoteDebuggingPort,
  userDataDir,
  browserProcess,
  timeout = 30_000,
  fetchImplementation = globalThis.fetch,
}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(
        `Browser exited before its DevTools endpoint was ready (exit ${browserProcess.exitCode})`
      );
    }

    let port = remoteDebuggingPort;
    if (port === 0) {
      try {
        const activePort = await readFile(
          path.join(userDataDir, 'DevToolsActivePort'),
          'utf8'
        );
        port = Number.parseInt(activePort.split(/\r?\n/, 1)[0], 10);
      } catch {
        port = 0;
      }
    }

    if (port > 0) {
      const endpoint = `http://127.0.0.1:${port}`;
      try {
        if (
          await fetchCdpVersion(
            endpoint,
            fetchImplementation,
            Math.max(1, deadline - Date.now())
          )
        ) {
          return endpoint;
        }
      } catch {
        // Chrome may have allocated the port before /json/version is ready.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out after ${timeout}ms waiting for the DevTools endpoint`
  );
}

/**
 * Spawn a genuine installed Chrome-family browser with an isolated profile,
 * wait for its loopback CDP endpoint, and attach through {@link connectBrowser}.
 *
 * @param {Object} options - Launch and connection options
 * @param {'playwright'|'puppeteer'} [options.engine='playwright'] - Automation engine
 * @param {string} [options.channel='chrome'] - Installed Chrome-family channel
 * @param {string} [options.executablePath] - Explicit installed browser executable
 * @param {string} [options.userDataDir] - Dedicated non-default browser profile
 * @param {number} [options.remoteDebuggingPort=0] - Loopback CDP port; zero lets Chrome choose
 * @param {boolean} [options.headless=false] - Run the installed browser headlessly
 * @param {string[]} [options.args] - Additional browser arguments
 * @param {number} [options.startupTimeout=30000] - CDP readiness timeout in milliseconds
 * @param {Object[]} [options.seedCookies] - Cookies to seed after connecting
 * @param {boolean} [options.verbose=false] - Show browser and connection logs
 * @returns {Promise<{browser: Object, page: Object, browserProcess: Object, cdpEndpoint: string, executablePath: string, userDataDir: string}>} Connected handles and process metadata
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

/** Dependency-injected implementation used by the public helper and tests. */
export async function launchAndConnectRealBrowserWithDependencies(
  options = {},
  dependencies = {}
) {
  const {
    engine = 'playwright',
    channel = 'chrome',
    executablePath: requestedExecutablePath,
    userDataDir = defaultUserDataDir(channel),
    remoteDebuggingPort = 0,
    headless = false,
    args = [],
    startupTimeout = 30_000,
    verbose = false,
    cdpEndpoint,
    wsEndpoint,
    ...connectionOptions
  } = options;
  if (cdpEndpoint || wsEndpoint) {
    throw new Error(
      'launchAndConnectRealBrowser creates its own endpoint; use connectBrowser to attach to an existing endpoint'
    );
  }

  assertDedicatedUserDataDir(userDataDir);
  await mkdir(userDataDir, { recursive: true });
  const resolveExecutable =
    dependencies.resolveExecutable ?? resolveSystemBrowserExecutable;
  const resolvedExecutablePath = await resolveExecutable({
    channel,
    executablePath: requestedExecutablePath,
  });
  const browserArgs = buildRealBrowserArgs({
    userDataDir,
    remoteDebuggingPort,
    headless,
    args,
  });
  const spawnBrowser = dependencies.spawnBrowser ?? spawn;
  const browserProcess = spawnBrowser(resolvedExecutablePath, browserArgs, {
    stdio: verbose ? 'inherit' : 'ignore',
  });

  try {
    const waitForEndpoint = dependencies.waitForEndpoint ?? waitForCdpEndpoint;
    const resolvedCdpEndpoint = await waitForEndpoint({
      remoteDebuggingPort,
      userDataDir,
      browserProcess,
      timeout: startupTimeout,
    });
    const connect = dependencies.connect ?? connectBrowser;
    const connection = await connect({
      engine,
      cdpEndpoint: resolvedCdpEndpoint,
      ...connectionOptions,
      verbose,
    });
    return {
      ...connection,
      browserProcess,
      cdpEndpoint: resolvedCdpEndpoint,
      executablePath: resolvedExecutablePath,
      userDataDir,
    };
  } catch (error) {
    if (browserProcess.exitCode === null) {
      browserProcess.kill();
    }
    throw error;
  }
}

export { defaultUserDataDir, knownDefaultUserDataDirs };
