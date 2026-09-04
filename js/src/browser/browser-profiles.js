import { access, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const SUPPORTED_COOKIE_BROWSERS = [
  'chrome',
  'edge',
  'brave',
  'chromium',
  'firefox',
];

function platformPath(platform) {
  return platform === 'win32' ? path.win32 : path;
}

export function normalizeCookieBrowser(browser) {
  const normalized = browser === 'msedge' ? 'edge' : browser;
  if (!SUPPORTED_COOKIE_BROWSERS.includes(normalized)) {
    throw new Error(
      `Unsupported browser: ${browser}. Expected one of ${SUPPORTED_COOKIE_BROWSERS.join(', ')}`
    );
  }
  return normalized;
}

export function browserProfileRoot(
  browser,
  {
    platform = process.platform,
    homeDir = os.homedir(),
    environment = process.env,
  } = {}
) {
  const normalizedBrowser = normalizeCookieBrowser(browser);
  const pathApi = platformPath(platform);
  if (platform === 'darwin') {
    const support = pathApi.join(homeDir, 'Library', 'Application Support');
    const roots = {
      brave: pathApi.join(support, 'BraveSoftware', 'Brave-Browser'),
      chrome: pathApi.join(support, 'Google', 'Chrome'),
      chromium: pathApi.join(support, 'Chromium'),
      edge: pathApi.join(support, 'Microsoft Edge'),
      firefox: pathApi.join(support, 'Firefox'),
    };
    return roots[normalizedBrowser];
  }
  if (platform === 'win32') {
    const localAppData =
      environment.LOCALAPPDATA ?? pathApi.join(homeDir, 'AppData', 'Local');
    const roamingAppData =
      environment.APPDATA ?? pathApi.join(homeDir, 'AppData', 'Roaming');
    const roots = {
      brave: pathApi.join(
        localAppData,
        'BraveSoftware',
        'Brave-Browser',
        'User Data'
      ),
      chrome: pathApi.join(localAppData, 'Google', 'Chrome', 'User Data'),
      chromium: pathApi.join(localAppData, 'Chromium', 'User Data'),
      edge: pathApi.join(localAppData, 'Microsoft', 'Edge', 'User Data'),
      firefox: pathApi.join(roamingAppData, 'Mozilla', 'Firefox'),
    };
    return roots[normalizedBrowser];
  }
  const roots = {
    brave: pathApi.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser'),
    chrome: pathApi.join(homeDir, '.config', 'google-chrome'),
    chromium: pathApi.join(homeDir, '.config', 'chromium'),
    edge: pathApi.join(homeDir, '.config', 'microsoft-edge'),
    firefox: pathApi.join(homeDir, '.mozilla', 'firefox'),
  };
  return roots[normalizedBrowser];
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function chromiumCookiePaths(profilePath, pathApi = path) {
  return [
    pathApi.join(profilePath, 'Network', 'Cookies'),
    pathApi.join(profilePath, 'Cookies'),
  ];
}

export async function findCookieDatabase(browser, profilePath, platform) {
  const pathApi = platformPath(platform ?? process.platform);
  if (normalizeCookieBrowser(browser) === 'firefox') {
    const candidate = pathApi.join(profilePath, 'cookies.sqlite');
    return (await pathExists(candidate)) ? candidate : null;
  }
  for (const candidate of chromiumCookiePaths(profilePath, pathApi)) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function listChromiumProfiles(browser, root, platform) {
  if (!(await pathExists(root))) {
    return [];
  }
  const pathApi = platformPath(platform);
  const localState = await readJson(pathApi.join(root, 'Local State'));
  const infoCache = localState.profile?.info_cache ?? {};
  const names = new Set(Object.keys(infoCache));
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        (entry.name === 'Default' || entry.name.startsWith('Profile '))
      ) {
        names.add(entry.name);
      }
    }
  } catch {
    return [];
  }

  const profiles = [];
  for (const name of names) {
    const profilePath = pathApi.join(root, name);
    if (!(await findCookieDatabase(browser, profilePath, platform))) {
      continue;
    }
    profiles.push({
      browser,
      name,
      displayName: infoCache[name]?.name ?? name,
      path: profilePath,
      isDefault:
        name === (localState.profile?.last_used ?? 'Default') ||
        (names.size === 1 && name === 'Default'),
    });
  }
  return profiles.sort(
    (left, right) =>
      Number(right.isDefault) - Number(left.isDefault) ||
      left.name.localeCompare(right.name)
  );
}

function parseIni(text) {
  const sections = [];
  let current;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = /^\[([^\]]+)]$/.exec(line);
    if (sectionMatch) {
      current = { section: sectionMatch[1] };
      sections.push(current);
      continue;
    }
    const separator = line.indexOf('=');
    if (current && separator > 0 && !line.startsWith(';')) {
      current[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return sections;
}

async function listFirefoxProfiles(root, platform) {
  if (!(await pathExists(root))) {
    return [];
  }
  const pathApi = platformPath(platform);
  let sections;
  try {
    sections = parseIni(
      await readFile(pathApi.join(root, 'profiles.ini'), 'utf8')
    );
  } catch {
    const profilesRoot = pathApi.join(root, 'Profiles');
    try {
      const entries = await readdir(profilesRoot, { withFileTypes: true });
      sections = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          section: 'Profile',
          Name: entry.name,
          Path: entry.name,
          ProfilesRoot: profilesRoot,
        }));
    } catch {
      return [];
    }
  }

  const profiles = [];
  for (const section of sections.filter(({ section }) =>
    section.startsWith('Profile')
  )) {
    if (!section.Path) {
      continue;
    }
    const relativeRoot = section.ProfilesRoot ?? root;
    const profilePath =
      section.IsRelative === '0'
        ? section.Path
        : pathApi.resolve(relativeRoot, section.Path);
    if (!(await findCookieDatabase('firefox', profilePath, platform))) {
      continue;
    }
    const displayName = section.Name ?? pathApi.basename(profilePath);
    profiles.push({
      browser: 'firefox',
      name: displayName,
      displayName,
      path: profilePath,
      isDefault: section.Default === '1',
    });
  }
  return profiles.sort(
    (left, right) =>
      Number(right.isDefault) - Number(left.isDefault) ||
      left.name.localeCompare(right.name)
  );
}

/** Discover cookie-bearing profiles from installed browsers. */
export async function listBrowserProfiles({
  browser,
  platform = process.platform,
  homeDir = os.homedir(),
  environment = process.env,
} = {}) {
  const browsers = browser
    ? [normalizeCookieBrowser(browser)]
    : SUPPORTED_COOKIE_BROWSERS;
  const profiles = [];
  for (const candidate of browsers) {
    const root = browserProfileRoot(candidate, {
      platform,
      homeDir,
      environment,
    });
    profiles.push(
      ...(candidate === 'firefox'
        ? await listFirefoxProfiles(root, platform)
        : await listChromiumProfiles(candidate, root, platform))
    );
  }
  return profiles;
}

export async function resolveBrowserProfile(options) {
  const browser = normalizeCookieBrowser(options.browser);
  const profiles = await listBrowserProfiles({ ...options, browser });
  const requested = options.profile;
  const selected = requested
    ? profiles.find(
        ({ name, displayName, path: profilePath }) =>
          requested === name ||
          requested === displayName ||
          requested === platformPath(options.platform).basename(profilePath)
      )
    : (profiles.find(({ isDefault }) => isDefault) ?? profiles[0]);
  if (!selected) {
    const detail = requested ? ` profile "${requested}"` : ' profile';
    throw new Error(`Could not find a cookie database for ${browser}${detail}`);
  }
  return selected;
}
