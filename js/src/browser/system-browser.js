import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Where Chrome-family browsers are installed and where their own (default)
 * profiles live, per platform. The launcher uses it to find an executable and
 * to refuse a default profile; profile migration uses it to find the source.
 */

export const CHANNEL_EXECUTABLE_NAMES = {
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

export function defaultUserDataDir(channel, homeDir = os.homedir()) {
  const directoryName = channel.replace(/[^a-z0-9_.-]/gi, '-');
  return path.join(
    homeDir,
    '.browser-commander',
    'real-browser',
    directoryName
  );
}

export function knownDefaultUserDataDirs({
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
