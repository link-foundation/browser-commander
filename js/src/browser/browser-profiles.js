import { access, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  BROWSER_IDS,
  browserFamily,
  isSingleProfileBrowser,
  normalizeBrowserId,
  resolveBrowserRoots,
} from './browser-sources.js';
import { resolveDefaultBrowser } from './default-browser.js';
import { findSafariCookieFile } from './safari-cookies.js';

/**
 * Keywords that select the operating-system default browser instead of a named
 * one, so `browser: 'default'` (or `'auto'`) imports from whatever a person
 * actually uses. Importing stays opt-in: callers pass this explicitly.
 */
const DEFAULT_BROWSER_KEYWORDS = new Set(['default', 'auto']);

/** Whether `browser` asks for the system default rather than a named browser. */
export function isDefaultBrowserKeyword(browser) {
  return (
    typeof browser === 'string' &&
    DEFAULT_BROWSER_KEYWORDS.has(browser.trim().toLowerCase())
  );
}

/**
 * Resolve a requested browser to a canonical catalogue id, expanding the
 * `default`/`auto` keywords to the system default browser. Named browsers are
 * normalized through the catalogue as before.
 */
export async function resolveSourceBrowser(
  browser,
  { platform = process.platform, environment = process.env, runCommand } = {}
) {
  if (!isDefaultBrowserKeyword(browser)) {
    return normalizeCookieBrowser(browser);
  }
  const resolved = await resolveDefaultBrowser({
    platform,
    environment,
    runCommand,
  });
  if (!resolved) {
    throw new Error(
      'Could not determine the system default browser; pass an explicit browser instead of "default".'
    );
  }
  return resolved;
}

/**
 * Every browser profile discovery can read from. Driven by the shared
 * `browser-sources.json` catalogue, so adding a browser there adds it here.
 */
export const SUPPORTED_COOKIE_BROWSERS = BROWSER_IDS;

function platformPath(platform) {
  return platform === 'win32' ? path.win32 : path;
}

/** Resolve a browser name (id or alias) to its canonical id. */
export function normalizeCookieBrowser(browser) {
  return normalizeBrowserId(browser);
}

/**
 * The primary profile root a browser uses on a platform, or `undefined` when
 * the browser does not run there.
 */
export function browserProfileRoot(
  browser,
  {
    platform = process.platform,
    homeDir = os.homedir(),
    environment = process.env,
  } = {}
) {
  const [root] = resolveBrowserRoots(browser, {
    platform,
    homeDir,
    environment,
  });
  return root;
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
  if (browserFamily(browser) === 'safari') {
    return findSafariCookieFile(profilePath);
  }
  if (browserFamily(browser) === 'firefox') {
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

/** Default profile first, then by name. */
function sortProfiles(profiles) {
  return profiles.sort(
    (left, right) =>
      Number(right.isDefault) - Number(left.isDefault) ||
      left.name.localeCompare(right.name)
  );
}

async function listChromiumProfiles(browser, root, platform) {
  if (!(await pathExists(root))) {
    return [];
  }
  const pathApi = platformPath(platform);

  // Opera-style browsers keep one profile in the root itself rather than in
  // Default/Profile N subdirectories.
  if (isSingleProfileBrowser(browser)) {
    if (!(await findCookieDatabase(browser, root, platform))) {
      return [];
    }
    return [
      {
        browser,
        name: 'Default',
        displayName: 'Default',
        path: root,
        isDefault: true,
      },
    ];
  }

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
  return sortProfiles(profiles);
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

async function listFirefoxProfiles(browser, root, platform) {
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
    if (!(await findCookieDatabase(browser, profilePath, platform))) {
      continue;
    }
    const displayName = section.Name ?? pathApi.basename(profilePath);
    profiles.push({
      browser,
      name: displayName,
      displayName,
      path: profilePath,
      isDefault: section.Default === '1',
    });
  }
  return sortProfiles(profiles);
}

async function listProfilesForBrowser(browser, platform, homeDir, environment) {
  const roots = resolveBrowserRoots(browser, {
    platform,
    homeDir,
    environment,
  });
  const family = browserFamily(browser);
  const profiles = [];
  for (const root of roots) {
    if (family === 'safari') {
      if (await findSafariCookieFile(root)) {
        return [
          {
            browser,
            name: 'Default',
            displayName: 'Default',
            path: root,
            isDefault: true,
          },
        ];
      }
      continue;
    }
    profiles.push(
      ...(family === 'firefox'
        ? await listFirefoxProfiles(browser, root, platform)
        : await listChromiumProfiles(browser, root, platform))
    );
  }
  return profiles;
}

/** Discover cookie-bearing profiles from installed browsers. */
export async function listBrowserProfiles({
  browser,
  platform = process.platform,
  homeDir = os.homedir(),
  environment = process.env,
  runCommand,
} = {}) {
  const browsers = browser
    ? [
        await resolveSourceBrowser(browser, {
          platform,
          environment,
          runCommand,
        }),
      ]
    : BROWSER_IDS;
  const profiles = [];
  // Several Firefox channels (firefox, firefox-developer, firefox-nightly)
  // share one profile root, so a catalogue-wide scan would otherwise report
  // the same profile under each id. Keep the first (canonical) browser.
  const seen = new Set();
  for (const candidate of browsers) {
    for (const profile of await listProfilesForBrowser(
      candidate,
      platform,
      homeDir,
      environment
    )) {
      if (seen.has(profile.path)) {
        continue;
      }
      seen.add(profile.path);
      profiles.push(profile);
    }
  }
  return profiles;
}

export async function resolveBrowserProfile(options) {
  const browser = await resolveSourceBrowser(options.browser, {
    platform: options.platform,
    environment: options.environment,
    runCommand: options.runCommand,
  });
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
