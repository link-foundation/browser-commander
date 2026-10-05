import path from 'node:path';
import os from 'node:os';

import { resolveImportSource } from '../browser-cookies.js';
import { browserFamily, isSingleProfileBrowser } from '../browser-sources.js';
import {
  browserProfileRoot,
  resolveBrowserProfile,
} from '../browser-profiles.js';
import { migrateBookmarks } from './bookmarks.js';
import { migrateCookies } from './cookies.js';
import { migrateExtensions } from './extensions.js';
import {
  migrateFirefoxBookmarks,
  migrateFirefoxPasswords,
  readFirefoxCookies,
  reportFirefoxHistory,
} from './firefox.js';
import { migrateHistory } from './history.js';
import { migratePasswords } from './passwords.js';
import { migratePreferences } from './preferences.js';
import {
  createSourceKeyResolver,
  localStatePathForProfile,
  resolveTargetKey,
} from './os-crypt-keys.js';

/**
 * Profile migration orchestrator.
 *
 * Copies a person's data from a real browser profile into a dedicated target
 * profile, one data class at a time, and returns the report shape documented in
 * `docs/cli-and-bridge.md`. Nothing is ever written to the source profile, and
 * every database read goes through a consistent read-only snapshot, so the
 * migration is safe to run while the source browser is open.
 *
 * Cookies are returned (not written): a running Chromium re-derives its own
 * cookie encryption, so the launcher seeds them over CDP with the existing
 * `seedCookies` path. Every other data class is written into the target profile
 * directory.
 */

export const ALL_DATA_CLASSES = Object.freeze([
  'cookies',
  'bookmarks',
  'history',
  'passwords',
  'preferences',
  'extensions',
]);

// Classification is driven by the shared catalogue so every Chromium variant
// (vivaldi, opera, arc, the chrome/edge channels, …) and every Firefox fork
// (librewolf, waterfox, zen, floorp, the firefox channels, …) is handled the
// same way as its canonical engine, not just the original four browsers.
function isChromiumBrowser(browser) {
  return browserFamily(browser) === 'chromium';
}

function isFirefoxBrowser(browser) {
  return browserFamily(browser) === 'firefox';
}

function emptyMigrated() {
  return {
    cookies: 0,
    bookmarks: 0,
    history: 0,
    passwords: 0,
    preferences: 0,
    extensions: 0,
  };
}

async function resolveSourceProfileDir({
  browser,
  profile,
  userDataDir,
  platform,
  homeDir,
  environment,
}) {
  // A Chromium profile lives in a named subdirectory of the user data dir,
  // except in single-profile browsers (Opera) that keep it in the root; for
  // Firefox the userDataDir already points at the profile.
  const nestsProfiles =
    isChromiumBrowser(browser) && !isSingleProfileBrowser(browser);
  if (userDataDir) {
    return nestsProfiles
      ? path.join(userDataDir, profile ?? 'Default')
      : userDataDir;
  }
  if (isChromiumBrowser(browser)) {
    const root = browserProfileRoot(browser, {
      platform,
      homeDir,
      environment,
    });
    return nestsProfiles ? path.join(root, profile ?? 'Default') : root;
  }
  const resolved = await resolveBrowserProfile({
    browser,
    profile,
    platform,
    homeDir,
    environment,
  });
  return resolved.path;
}

function mergeReport(report, className, fragment) {
  report.migrated[className] += fragment.migrated ?? 0;
  report.skipped.push(...(fragment.skipped ?? []));
  report.warnings.push(...(fragment.warnings ?? []));
}

async function resolvePasswordKeys({
  keys,
  browser,
  targetBrowser,
  platform,
  sourceProfileDir,
  environment,
}) {
  if (keys?.targetKey) {
    return keys;
  }
  if (platform !== 'darwin' && platform !== 'linux') {
    return null;
  }
  const { key: targetKey, prefix: targetPrefix } = await resolveTargetKey({
    browser: targetBrowser,
    platform,
    environment,
  });
  const resolveSourceKey = isChromiumBrowser(browser)
    ? createSourceKeyResolver({
        browser,
        platform,
        localStatePath: localStatePathForProfile(sourceProfileDir),
        environment,
      })
    : undefined;
  return { targetKey, targetPrefix, resolveSourceKey };
}

/**
 * Migrate a browser profile into a dedicated target profile directory.
 *
 * @param {Object} options
 * @param {{browser: string, profile: (string|undefined), userDataDir: (string|undefined)}} options.from
 * @param {string} options.to - Target profile directory
 * @param {string[]} [options.include=ALL_DATA_CLASSES]
 * @param {string[]} [options.domains] - Cookie domain filter
 * @param {string} [options.platform=process.platform]
 * @param {string} [options.targetBrowser] - Launching browser channel (key derivation)
 * @param {Object} [options.keys] - Injected password keys {resolveSourceKey, targetKey, targetPrefix, primaryPassword}
 * @param {string} [options.homeDir]
 * @param {Object} [options.environment]
 * @returns {Promise<{source: Object, target: string, migrated: Object, skipped: Array, warnings: Array, cookies: Object[]}>}
 */
export async function migrateProfile({
  from,
  to,
  include = ALL_DATA_CLASSES,
  domains,
  platform = process.platform,
  targetBrowser,
  keys,
  homeDir = os.homedir(),
  environment = process.env,
  runCommand,
}) {
  if (!from?.browser) {
    throw new TypeError('migrateProfile requires from.browser');
  }
  if (!to) {
    throw new TypeError('migrateProfile requires a target directory (to)');
  }
  // An explicit userDataDir names the source, so only an installed-browser
  // import is steered towards the profile holding the requested domains.
  const source = await resolveImportSource({
    browser: from.browser,
    domains: from.userDataDir ? undefined : domains,
    platform,
    homeDir,
    environment,
    runCommand,
  });
  const { browser } = source;
  const profile = from.profile ?? source.profile ?? 'Default';
  const isFirefox = isFirefoxBrowser(browser);
  const sourceProfileDir = await resolveSourceProfileDir({
    browser,
    profile,
    userDataDir: from.userDataDir,
    platform,
    homeDir,
    environment,
  });
  const selected = new Set(include);
  const report = {
    source: { browser, profile, userDataDir: from.userDataDir ?? null },
    target: to,
    migrated: emptyMigrated(),
    skipped: [],
    warnings: [],
    cookies: [],
  };
  if (source.warning) {
    report.warnings.push(source.warning);
  }

  if (selected.has('cookies')) {
    if (isFirefox) {
      const cookies = await readFirefoxCookies({
        profileDir: sourceProfileDir,
        domains,
      });
      report.cookies = cookies;
      report.migrated.cookies = cookies.length;
    } else {
      const fragment = await migrateCookies({
        browser,
        profile,
        sourceProfileDir,
        domains,
        readerOptions: { platform, homeDir, environment },
      });
      report.cookies = fragment.cookies;
      report.migrated.cookies = fragment.migrated;
      report.skipped.push(...fragment.skipped);
      report.warnings.push(...fragment.warnings);
    }
  }

  if (selected.has('bookmarks')) {
    mergeReport(
      report,
      'bookmarks',
      isFirefox
        ? await migrateFirefoxBookmarks({
            profileDir: sourceProfileDir,
            targetProfileDir: to,
          })
        : await migrateBookmarks({
            sourceProfileDir,
            targetProfileDir: to,
          })
    );
  }

  if (selected.has('history')) {
    mergeReport(
      report,
      'history',
      isFirefox
        ? await reportFirefoxHistory({ profileDir: sourceProfileDir })
        : await migrateHistory({
            sourceProfileDir,
            targetProfileDir: to,
          })
    );
  }

  if (selected.has('preferences') && !isFirefox) {
    mergeReport(
      report,
      'preferences',
      await migratePreferences({ sourceProfileDir, targetProfileDir: to })
    );
  }

  if (selected.has('extensions') && !isFirefox) {
    mergeReport(
      report,
      'extensions',
      await migrateExtensions({ sourceProfileDir, targetProfileDir: to })
    );
  }

  if (selected.has('passwords')) {
    const passwordKeys = await resolvePasswordKeys({
      keys,
      browser,
      targetBrowser: targetBrowser ?? (isFirefox ? 'chrome' : browser),
      platform,
      sourceProfileDir,
      environment,
    });
    if (!passwordKeys?.targetKey) {
      report.skipped.push({
        type: 'passwords',
        item: 'Login Data',
        reason: 'target-key-unavailable',
      });
      report.warnings.push({
        type: 'passwords',
        item: 'Login Data',
        reason: 'target-key-unavailable',
        detail:
          'A target encryption key was not available (on Windows the launcher must generate one and write it into the target Local State); passwords were not migrated.',
      });
    } else if (isFirefox) {
      mergeReport(
        report,
        'passwords',
        await migrateFirefoxPasswords({
          profileDir: sourceProfileDir,
          targetProfileDir: to,
          platform,
          targetKey: passwordKeys.targetKey,
          targetPrefix: passwordKeys.targetPrefix,
          primaryPassword: passwordKeys.primaryPassword,
        })
      );
    } else {
      mergeReport(
        report,
        'passwords',
        await migratePasswords({
          sourceProfileDir,
          targetProfileDir: to,
          platform,
          resolveSourceKey: passwordKeys.resolveSourceKey,
          targetKey: passwordKeys.targetKey,
          targetPrefix: passwordKeys.targetPrefix,
        })
      );
    }
  }

  return report;
}
