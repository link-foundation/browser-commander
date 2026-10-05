import path from 'node:path';
import os from 'node:os';

import { resolveImportSource } from '../browser-cookies.js';
import { browserFamily, isSingleProfileBrowser } from '../browser-sources.js';
import {
  browserProfileRoot,
  resolveBrowserProfile,
} from '../browser-profiles.js';
import { migrateSafariClass } from './safari-import.js';
import {
  validateMigrationOptions,
  validateMigrationPaths,
} from './validation.js';
import { migrateBookmarks } from './bookmarks.js';
import { pathExists } from './fs-utils.js';
import { migrateCookies } from './cookies.js';
import {
  ADDITIONAL_DATA_CLASSES,
  reportAdditionalClasses,
} from './data-classes.js';
import { migrateExtensions } from './extensions.js';
import {
  migrateFirefoxBookmarks,
  migrateFirefoxPasswords,
  readFirefoxCookies,
} from './firefox.js';
import { migrateFirefoxHistory } from './firefox-history.js';
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
 * `seedCookies` path. Supported file imports are written into the target profile;
 * classes without a native writer receive explicit skipped reports.
 */

export const ALL_DATA_CLASSES = Object.freeze([
  'cookies',
  'bookmarks',
  'history',
  'passwords',
  'preferences',
  'extensions',
  ...ADDITIONAL_DATA_CLASSES,
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
  return Object.fromEntries(ALL_DATA_CLASSES.map((type) => [type, 0]));
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
 * @param {string[]} [options.domains] - Per-site host/subdomain filter
 * @param {boolean} [options.includePaymentCards=false] - Separate explicit payment-card consent
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
  passwordCsv,
  includePaymentCards = false,
}) {
  if (!from?.browser) {
    throw new TypeError('migrateProfile requires from.browser');
  }
  if (!to) {
    throw new TypeError('migrateProfile requires a target directory (to)');
  }
  validateMigrationOptions({
    include,
    domains,
    targetBrowser,
    to,
    platform,
    homeDir,
    environment,
    classes: ALL_DATA_CLASSES,
    includePaymentCards,
  });
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
  if (!['chromium', 'firefox', 'safari'].includes(browserFamily(browser))) {
    throw new TypeError(
      `Browser ${browser} supports detection only; its profile format is not supported for migration`
    );
  }
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
  validateMigrationPaths(sourceProfileDir, to);
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
  report.skipped.push(
    ...reportAdditionalClasses({
      selected,
      profileDir: sourceProfileDir,
      includePaymentCards,
    })
  );

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

  if (browserFamily(browser) === 'safari') {
    return migrateSafariProfile({
      selected,
      passwordCsv,
      keys,
      browser,
      targetBrowser,
      platform,
      sourceProfileDir,
      environment,
      from,
      to,
      domains,
      homeDir,
      report,
    });
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
        ? await migrateFirefoxHistory({
            profileDir: sourceProfileDir,
            targetProfileDir: to,
            domains,
          })
        : await migrateHistory({
            sourceProfileDir,
            targetProfileDir: to,
            domains,
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

  if (isFirefox) {
    for (const type of ['preferences', 'extensions']) {
      if (selected.has(type)) {
        report.skipped.push({
          type,
          item: sourceProfileDir,
          reason: 'firefox-class-not-supported',
          detail:
            'Firefox preferences and extensions cannot be copied into a Chromium profile.',
        });
      }
    }
  }

  if (selected.has('passwords')) {
    await migratePasswordClass(report, {
      keys,
      browser,
      targetBrowser,
      platform,
      sourceProfileDir,
      environment,
      to,
      isFirefox,
      domains,
    });
  }

  return report;
}

async function migrateSafariProfile({
  report,
  browser,
  domains,
  environment,
  from,
  homeDir,
  keys,
  passwordCsv,
  platform,
  selected,
  sourceProfileDir,
  targetBrowser,
  to,
}) {
  const passwordKeys =
    selected.has('passwords') && passwordCsv
      ? await resolvePasswordKeys({
          keys,
          browser,
          targetBrowser: targetBrowser ?? 'chrome',
          platform,
          sourceProfileDir,
          environment,
        })
      : null;
  for (const type of ALL_DATA_CLASSES.filter(
    (type) =>
      type !== 'cookies' &&
      !ADDITIONAL_DATA_CLASSES.includes(type) &&
      selected.has(type)
  )) {
    mergeReport(
      report,
      type,
      await migrateSafariClass({
        type,
        profileDir: sourceProfileDir,
        targetProfileDir: to,
        domains,
        passwordCsv,
        passwordKeys,
        platform,
        legacyDir:
          from.userDataDir ||
          path.basename(path.dirname(sourceProfileDir)) === 'Profiles'
            ? undefined
            : path.join(
                homeDir,
                'Library',
                browser === 'safari' ? 'Safari' : 'Safari Technology Preview'
              ),
      })
    );
  }
  if (report.cookies.length) {
    report.warnings.push({
      type: 'cookies',
      item: browser,
      reason: 'safari-samesite-unavailable',
      detail:
        'Cookies.binarycookies does not store SameSite; imported cookies use Lax.',
    });
  }
  return report;
}

async function migratePasswordClass(
  report,
  {
    browser,
    domains,
    environment,
    isFirefox,
    keys,
    platform,
    sourceProfileDir,
    targetBrowser,
    to,
  }
) {
  if (
    browser === 'yandex' &&
    (await pathExists(path.join(sourceProfileDir, 'Ya Passman Data')))
  ) {
    report.skipped.push({
      type: 'passwords',
      item: 'Ya Passman Data',
      reason: 'yandex-passman-encryption-unsupported',
      detail:
        'Ya Passman Data uses local_encryptor_data and may require a Yandex master password; this extra encryption layer is not supported. Export passwords to a supported format instead.',
    });
    return report;
  }
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
        domains,
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
        domains,
      })
    );
  }
}
