import { rm } from 'node:fs/promises';
import path from 'node:path';

import { assertProfileDirectoryName } from './profile-directory.js';

/**
 * A profile directory is permanent storage: all cookies, session ones
 * included, survive restarts (issue #187).
 *
 * Chromium deletes cookies without an expiry date when its profile starts,
 * unless the last exit was a crash or the startup setting is "Continue where
 * you left off" (`ProfileImpl::ShouldRestoreOldSessionCookies`). A normal
 * `close()` is a clean exit, so a persistent profile lost every session login
 * on each restart. `--restore-last-session` turns that setting on for one
 * launch, and the browser's own encrypted cookie store keeps the cookies; no
 * extra file is written (measured with Chrome for Testing 153 and Google
 * Chrome 155, experiments/issue-187/raw-chrome.mjs).
 */
export const KEEP_SESSION_COOKIES_SWITCH = '--restore-last-session';

/**
 * The field trial that makes Chrome for Testing continue the last session by
 * default (`SessionRestoreInfobar.Enabled_ContinueDefault`). It keeps session
 * cookies without any switch, so the explicit opt-out turns it off; Google
 * Chrome without a variations seed and Playwright's engine launch
 * (`--disable-field-trial-config`) behave the same way already.
 */
export const CONTINUE_SESSION_FEATURE = 'SessionRestoreInfobar';

/**
 * Firefox keeps session cookies through SessionStore when it restores the
 * previous session at startup ("Open previous windows and tabs"); geckodriver
 * writes `browser.startup.page = 0` otherwise (measured with Firefox 158 and
 * geckodriver 0.37.1, experiments/issue-187/firefox.mjs). The cookies live in
 * the session file, so restored tabs are closed after launch instead of the
 * file being deleted.
 */
export const FIREFOX_KEEP_SESSION_COOKIES_PREFERENCES = Object.freeze({
  'browser.startup.page': 3,
});

/**
 * The files a Chromium profile directory restores the last session's tabs
 * from: `Sessions/` in current releases, the four legacy files before it.
 * Cookies are kept in `Cookies`, so deleting these only drops the tabs.
 */
export const SESSION_RESTORE_FILES = Object.freeze([
  'Sessions',
  'Current Session',
  'Current Tabs',
  'Last Session',
  'Last Tabs',
]);

/**
 * Marks a profile the launcher just created for a launch that outlives it
 * (`launchBrowser({keepOpen: true})` without `userDataDir`): it starts empty,
 * so it gets a temporary profile's command line.
 */
export const FRESH_PROFILE = Symbol('browser-commander.freshProfile');

function assertOptionalBoolean(value, name) {
  if (value !== undefined && value !== null && typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`);
  }
}

/**
 * Whether a launch keeps session cookies: the caller's choice, otherwise yes
 * for a persistent profile and no for a temporary one, which starts empty.
 *
 * @param {Object} options
 * @param {boolean} [options.keepSessionCookies]
 * @param {boolean} options.temporaryProfile
 * @returns {boolean|undefined} undefined for a temporary profile without an explicit choice (today's command line)
 */
export function resolveKeepSessionCookies({
  keepSessionCookies,
  temporaryProfile,
  [FRESH_PROFILE]: freshProfile,
}) {
  assertOptionalBoolean(keepSessionCookies, 'keepSessionCookies');
  if (typeof keepSessionCookies === 'boolean') {
    return keepSessionCookies;
  }
  return temporaryProfile || freshProfile === true ? undefined : true;
}

/** Validate the launch options of this module before anything starts. */
export function validateSessionCookieOptions({
  keepSessionCookies,
  restoreTabs,
} = {}) {
  assertOptionalBoolean(keepSessionCookies, 'keepSessionCookies');
  assertOptionalBoolean(restoreTabs, 'restoreTabs');
}

/**
 * The Chromium switches for a persistent profile, for apps that start the
 * browser themselves and attach over CDP. Combine with
 * {@link clearRestoredTabs} to start with one tab.
 *
 * @param {Object} [options]
 * @param {boolean} [options.keepSessionCookies=true] - false asks for Chromium's default of deleting session cookies at startup
 * @returns {string[]}
 */
export function persistentProfileArgs({ keepSessionCookies = true } = {}) {
  assertOptionalBoolean(keepSessionCookies, 'keepSessionCookies');
  if (keepSessionCookies === false) {
    return [`--disable-features=${CONTINUE_SESSION_FEATURE}`];
  }
  return [KEEP_SESSION_COOKIES_SWITCH];
}

/** The switches for a resolved choice; none when it is undefined. */
export function sessionCookieArgs(keepSessionCookies) {
  return keepSessionCookies === undefined
    ? []
    : persistentProfileArgs({ keepSessionCookies });
}

/** The `--profile-directory` an argument list selects, 'Default' otherwise. */
export function profileDirectoryFromArgs(args = []) {
  const prefix = '--profile-directory=';
  const selected = args.findLast((argument) => argument.startsWith(prefix));
  return selected ? selected.slice(prefix.length) : 'Default';
}

/**
 * Delete the tabs a Chromium profile would restore, keeping its cookies, so
 * `--restore-last-session` starts with the start URL only.
 *
 * @param {string} userDataDir
 * @param {Object} [options]
 * @param {string} [options.profileDirectory='Default']
 */
export async function clearRestoredTabs(
  userDataDir,
  { profileDirectory = 'Default' } = {}
) {
  assertProfileDirectoryName(profileDirectory);
  await Promise.all(
    SESSION_RESTORE_FILES.map((name) =>
      rm(path.join(userDataDir, profileDirectory, name), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      })
    )
  );
}

/**
 * Prepare a Chromium profile for a launch that keeps session cookies: unless
 * `restoreTabs` is true the last session's tabs are deleted first, so the
 * driven tab is the only one.
 */
export async function prepareSessionRestore(
  userDataDir,
  { keepSessionCookies, restoreTabs = false, args = [] }
) {
  if (keepSessionCookies === true && restoreTabs !== true) {
    await clearRestoredTabs(userDataDir, {
      profileDirectory: profileDirectoryFromArgs(args),
    });
  }
}

/** A launch-result warning that session cookies are not kept. */
export function sessionCookieWarning(reason, detail) {
  return { item: 'keepSessionCookies', reason, detail };
}
