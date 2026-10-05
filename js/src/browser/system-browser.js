import { constants } from 'node:fs';
import { physicalPath } from './browser-profile-files.js';
import {
  BROWSER_SOURCES,
  resolveBrowserRoots,
  resolveBrowserExecutables,
} from './browser-sources.js';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Where Chrome-family browsers are installed and where their own (default)
 * profiles live, per platform. The launcher uses it to find an executable and
 * to refuse a default profile; profile migration uses it to find the source.
 */

export const CHANNEL_EXECUTABLE_NAMES = Object.freeze(
  Object.fromEntries(
    BROWSER_SOURCES.flatMap((browser) =>
      [browser.id, ...(browser.aliases ?? [])].map((name) => [
        name,
        browser.executableNames ?? [],
      ])
    )
  )
);

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
  return BROWSER_SOURCES.flatMap((browser) =>
    resolveBrowserRoots(browser.id, {
      platform,
      homeDir,
      environment,
    })
  );
}

/** Ensure Chrome is not asked to expose the user's default profile over CDP. */
export function assertDedicatedUserDataDir(userDataDir, platformOptions = {}) {
  if (!userDataDir) {
    throw new Error('launchAndConnectRealBrowser requires a userDataDir');
  }
  const platform = platformOptions.platform ?? process.platform;
  const pathApi = platformPath(platform);
  const normalize = (value) => {
    let resolved = pathApi.resolve(value).replace(/[\\/]+$/, '');
    if (platform === process.platform) {
      resolved = physicalPath(resolved);
    }
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const requested = normalize(userDataDir);
  const isDefault = knownDefaultUserDataDirs(platformOptions).some(
    (directory) =>
      requested === normalize(directory) ||
      requested.startsWith(`${normalize(directory)}${pathApi.sep}`)
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
  if (!CHANNEL_EXECUTABLE_NAMES[channel]?.length) {
    throw new Error(
      `Unknown browser channel: ${channel}. Expected one of ${Object.keys(CHANNEL_EXECUTABLE_NAMES).join(', ')}`
    );
  }
  return resolveBrowserExecutables(channel, { platform, environment });
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
