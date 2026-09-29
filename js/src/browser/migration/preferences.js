import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists } from './fs-utils.js';

/**
 * Preferences migration.
 *
 * Chrome's `Preferences` file is a large JSON document. Copying it wholesale
 * would drag machine- and session-specific state into the dedicated profile
 * (window placement, the profile's own GAIA identity, per-profile paths), so a
 * migration copies only a documented, portable subset and merges it into the
 * target's existing `Preferences`.
 *
 * The subset is the settings a person recognizes as "my browser preferences":
 *
 * - `intl.accept_languages`   - the Accept-Language list.
 * - `intl.selected_languages` - the UI language order.
 * - `spellcheck.dictionaries` - enabled spellcheck dictionaries.
 * - `default_search_provider_data` - a custom default search engine.
 * - `browser.theme`           - the applied theme id and colors.
 * - `extensions.theme`        - the theme extension bookkeeping.
 * - `homepage`, `homepage_is_newtabpage` - the configured homepage.
 * - `session.startup_urls`, `session.restore_on_startup` - the on-startup pages.
 * - `bookmark_bar.show_on_all_tabs` - whether the bookmarks bar is always shown.
 *
 * `download.default_directory` is deliberately excluded: a path that exists on
 * the source machine's account may not exist for the dedicated profile, and a
 * migrated download location is more surprising than helpful.
 *
 * `Secure Preferences` (the file that carries a per-setting HMAC to detect
 * tampering) is not touched; the settings above live in the plain `Preferences`
 * file, which Chrome does not HMAC-protect.
 */

/** Dotted paths copied from the source Preferences into the target. */
export const MIGRATED_PREFERENCE_PATHS = Object.freeze([
  'intl.accept_languages',
  'intl.selected_languages',
  'spellcheck.dictionaries',
  'default_search_provider_data',
  'browser.theme',
  'extensions.theme',
  'homepage',
  'homepage_is_newtabpage',
  'session.startup_urls',
  'session.restore_on_startup',
  'bookmark_bar.show_on_all_tabs',
]);

function getPath(object, dottedPath) {
  return dottedPath
    .split('.')
    .reduce(
      (node, key) => (node && typeof node === 'object' ? node[key] : undefined),
      object
    );
}

function setPath(object, dottedPath, value) {
  const keys = dottedPath.split('.');
  let node = object;
  for (const key of keys.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== 'object') {
      node[key] = {};
    }
    node = node[key];
  }
  node[keys.at(-1)] = value;
}

/**
 * Merge the selected subset of source Preferences into a target Preferences
 * object (pure, so it is easy to unit-test).
 *
 * @param {Object} source - Parsed source Preferences
 * @param {Object} target - Parsed target Preferences (mutated and returned)
 * @param {string[]} [paths=MIGRATED_PREFERENCE_PATHS]
 * @returns {{merged: Object, migratedPaths: string[]}}
 */
export function mergePreferenceSubset(
  source,
  target,
  paths = MIGRATED_PREFERENCE_PATHS
) {
  const migratedPaths = [];
  for (const dottedPath of paths) {
    const value = getPath(source, dottedPath);
    if (value !== undefined) {
      setPath(target, dottedPath, value);
      migratedPaths.push(dottedPath);
    }
  }
  return { merged: target, migratedPaths };
}

/**
 * Migrate the selected Preferences subset into the target profile.
 *
 * @param {Object} options
 * @param {string} options.sourceProfileDir
 * @param {string} options.targetProfileDir
 * @returns {Promise<{migrated: number, skipped: Array, warnings: Array}>}
 */
export async function migratePreferences({
  sourceProfileDir,
  targetProfileDir,
}) {
  const sourcePath = path.join(sourceProfileDir, 'Preferences');
  if (!(await pathExists(sourcePath))) {
    return {
      migrated: 0,
      skipped: [
        { type: 'preferences', item: 'Preferences', reason: 'source-missing' },
      ],
      warnings: [],
    };
  }
  const source = JSON.parse(await readFile(sourcePath, 'utf8'));
  const targetPath = path.join(targetProfileDir, 'Preferences');
  let target = {};
  if (await pathExists(targetPath)) {
    try {
      target = JSON.parse(await readFile(targetPath, 'utf8'));
    } catch {
      target = {};
    }
  }
  const { merged, migratedPaths } = mergePreferenceSubset(source, target);
  await mkdir(targetProfileDir, { recursive: true });
  await writeFile(targetPath, JSON.stringify(merged));
  return { migrated: migratedPaths.length, skipped: [], warnings: [] };
}
