import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Chrome skips its first-run experience when this file exists in the user
 * data directory; it is what Chrome itself writes after the first run.
 * Writing it keeps `--no-first-run` off the command line (issue #103), and it
 * is required for a headful launch at all: without it the first-run dialog
 * holds startup and the DevTools endpoint never appears (measured with Chrome
 * 153, experiments/issue-105/headful-first-run.mjs).
 */
export const FIRST_RUN_SENTINEL = 'First Run';

/** Chrome's profile-wide settings file, next to the profile directories. */
export const LOCAL_STATE_FILE = 'Local State';
export const PREFERENCES_FILE = path.join('Default', 'Preferences');

/**
 * Local State written into a brand-new user data directory.
 *
 * With only the First Run sentinel, Chrome treats a new directory like a
 * browser that was just updated and opens a "What's new" tab next to the New
 * Tab page, a moment after startup (measured with Chrome 153,
 * experiments/issue-105/whats-new-local-state.mjs). That second tab takes the
 * foreground after the engine has attached, so the tab being driven would
 * report `document.hidden === true`. Chrome records the milestone it last
 * showed What's New for in `browser.last_whats_new_version` and skips the tab
 * when it is not older than the running version; a milestone no release has
 * reached keeps the tab closed without asking the binary for its version.
 *
 * Microsoft Edge ignores both and opens its own first-run tab,
 * `edge://welcome-edge/`, which takes the foreground the same way; it is
 * skipped once Edge has recorded `fre.has_user_seen_fre` (measured with Edge
 * 153, experiments/issue-103/edge-first-run.sh). Chrome ignores the key.
 */
export const INITIAL_LOCAL_STATE = Object.freeze({
  browser: Object.freeze({ last_whats_new_version: 9999 }),
  fre: Object.freeze({ has_user_seen_fre: true }),
});

/** Prefix of the fresh profiles Browser Commander creates and deletes. */
export const TEMPORARY_PROFILE_PREFIX = 'browser-commander-profile-';

/**
 * Make sure a user data directory exists and has the First Run sentinel.
 *
 * An existing sentinel is left alone, so a profile Chrome already used keeps
 * its timestamp, and Local State is only written when Chrome has not written
 * one yet.
 *
 * @param {string} userDataDir
 * @returns {Promise<string>} The same directory
 */
function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be a JSON object`);
  }
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new TypeError(`profile setting key ${key} is not allowed`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] = deepMerge(
        target[key] &&
          typeof target[key] === 'object' &&
          !Array.isArray(target[key])
          ? target[key]
          : {},
        value
      );
    } else {
      target[key] = value;
    }
  }
  return target;
}

async function mergeJsonFile(file, defaults, overrides) {
  let current = {};
  try {
    current = JSON.parse(await readFile(file, 'utf8'));
    assertObject(current, file);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  const merged = deepMerge(deepMerge(current, defaults), overrides);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(merged));
}

/** Merge launch settings into a fresh, migrated, or snapshotted profile. */
export async function configureUserDataDir(
  userDataDir,
  {
    defaultBrowserCheck,
    preferences = {},
    localState = {},
    profileDirectory = 'Default',
  } = {}
) {
  assertObject(preferences, 'preferences');
  assertObject(localState, 'localState');
  if (
    defaultBrowserCheck !== undefined &&
    typeof defaultBrowserCheck !== 'boolean'
  ) {
    throw new TypeError('defaultBrowserCheck must be a boolean');
  }
  if (
    typeof profileDirectory !== 'string' ||
    !profileDirectory ||
    path.basename(profileDirectory) !== profileDirectory ||
    profileDirectory === '.' ||
    profileDirectory === '..'
  ) {
    throw new TypeError('profileDirectory must be one profile directory name');
  }
  const profilePreferences = deepMerge(
    { browser: { check_default_browser: false } },
    preferences
  );
  assertObject(profilePreferences.browser, 'preferences.browser');
  if (defaultBrowserCheck !== undefined) {
    profilePreferences.browser.check_default_browser = defaultBrowserCheck;
  }
  await mergeJsonFile(
    path.join(userDataDir, profileDirectory, 'Preferences'),
    {},
    profilePreferences
  );
  const check = profilePreferences.browser?.check_default_browser === true;
  await mergeJsonFile(
    path.join(userDataDir, LOCAL_STATE_FILE),
    {
      browser: {
        default_browser_infobar_declined_count: check ? 0 : 5,
        default_browser_declined_count: check ? 0 : 5,
      },
    },
    localState
  );
}

export async function prepareUserDataDir(userDataDir, options = {}) {
  if (options.firstRun !== undefined && typeof options.firstRun !== 'boolean') {
    throw new TypeError('firstRun must be a boolean');
  }
  await mkdir(userDataDir, { recursive: true });
  if (options.firstRun !== true) {
    await writeFile(path.join(userDataDir, FIRST_RUN_SENTINEL), '', {
      flag: 'a',
    });
  }
  try {
    await writeFile(
      path.join(userDataDir, LOCAL_STATE_FILE),
      JSON.stringify(INITIAL_LOCAL_STATE),
      { flag: 'wx' }
    );
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
  await configureUserDataDir(userDataDir, options);
  return userDataDir;
}

/**
 * Create a fresh, empty profile for one launch.
 *
 * @param {Object} [options]
 * @param {string} [options.parent=os.tmpdir()] - Directory to create it in
 * @returns {Promise<string>} Path of the new user data directory
 */
export async function createTemporaryUserDataDir({
  parent = os.tmpdir(),
  ...options
} = {}) {
  const userDataDir = await mkdtemp(
    path.join(parent, TEMPORARY_PROFILE_PREFIX)
  );
  return await prepareUserDataDir(userDataDir, options);
}

/**
 * Delete a temporary profile. Chrome can still be flushing files for a moment
 * after its process exits, so removal is retried.
 *
 * @param {string} userDataDir
 */
export async function removeUserDataDir(userDataDir) {
  await rm(userDataDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
