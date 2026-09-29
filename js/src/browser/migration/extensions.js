import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readJsonIfPresent } from './fs-utils.js';

/**
 * Extension migration.
 *
 * A Chromium extension lives in two places in a profile:
 *
 * - its unpacked files under `Extensions/<id>/<version>/`, and
 * - a bookkeeping entry under `extensions.settings.<id>` in `Secure
 *   Preferences` (which records the install location, version, granted
 *   permissions and enabled state).
 *
 * This module copies both: the extension's version directory and the
 * `extensions.settings` entry.
 *
 * ## Secure Preferences MAC (honest limitation)
 *
 * `Secure Preferences` is protected by a per-entry HMAC ("MAC"). Chrome
 * computes each MAC with a seed built from a hard-coded key baked into the
 * browser binary combined with a per-profile/OS identifier (on Windows the seed
 * is additionally tied to the machine SID via the `machine_id`). Because that
 * seed differs for the dedicated target profile, a MAC copied from the source
 * profile will not validate, and Chrome treats an entry with an invalid MAC as
 * tampering: it disables (or silently drops) the extension on the next launch
 * and shows the "settings were changed" reset bubble.
 *
 * We cannot forge a valid MAC without the browser's embedded key, so the copy
 * is made on a best-effort basis and every migrated extension is reported with
 * a warning explaining that the user will likely have to re-enable it (or
 * re-install it from the Web Store, which restores a valid MAC). This is the
 * honest, documented behaviour rather than a silent partial success.
 *
 * References:
 * - https://chromium.googlesource.com/chromium/src/+/HEAD/services/preferences/tracked/README.md
 * - https://www.chromium.org/developers/design-documents/preferences (tracked/protected preferences)
 *
 * ## Excluded extensions
 *
 * Policy-installed and component/built-in extensions are never copied: they are
 * managed by enterprise policy or shipped with the browser, so copying their
 * files into a user profile is both pointless (the browser re-adds them) and
 * potentially conflicting. They are identified by the `location` value in the
 * settings entry.
 */

// Chrome's `Manifest::Location` values. Component/built-in and policy-managed
// extensions are excluded from a migration.
const EXCLUDED_LOCATIONS = new Set([
  5, // COMPONENT
  7, // EXTERNAL_POLICY_DOWNLOAD
  9, // EXTERNAL_POLICY
  10, // EXTERNAL_COMPONENT
]);

const SECURE_PREFERENCES = 'Secure Preferences';

/**
 * Decide which extension ids are eligible to migrate from a settings map.
 *
 * @param {Object} settings - `extensions.settings` from Secure Preferences
 * @returns {{eligible: string[], excluded: Array<{id: string, reason: string}>}}
 */
export function selectMigratableExtensions(settings) {
  const eligible = [];
  const excluded = [];
  for (const [id, entry] of Object.entries(settings ?? {})) {
    const location = Number(entry?.location);
    if (EXCLUDED_LOCATIONS.has(location)) {
      excluded.push({ id, reason: 'policy-or-component-extension' });
      continue;
    }
    if (entry?.was_installed_by_default === true && !entry?.manifest) {
      excluded.push({ id, reason: 'default-extension' });
      continue;
    }
    eligible.push(id);
  }
  return { eligible, excluded };
}

async function copyExtensionFiles(
  sourceExtensionsDir,
  targetExtensionsDir,
  id
) {
  const sourceDir = path.join(sourceExtensionsDir, id);
  if (!(await pathExists(sourceDir))) {
    return false;
  }
  await mkdir(targetExtensionsDir, { recursive: true });
  await cp(sourceDir, path.join(targetExtensionsDir, id), {
    recursive: true,
    force: true,
  });
  return true;
}

/**
 * Migrate extensions from a source profile into the target profile.
 *
 * @param {Object} options
 * @param {string} options.sourceProfileDir
 * @param {string} options.targetProfileDir
 * @returns {Promise<{migrated: number, skipped: Array, warnings: Array}>}
 */
export async function migrateExtensions({
  sourceProfileDir,
  targetProfileDir,
}) {
  const skipped = [];
  const warnings = [];

  const sourceExtensionsDir = path.join(sourceProfileDir, 'Extensions');
  if (!(await pathExists(sourceExtensionsDir))) {
    return { migrated: 0, skipped: [], warnings: [] };
  }

  const securePrefs = await readJsonIfPresent(
    path.join(sourceProfileDir, SECURE_PREFERENCES)
  );
  const settings = securePrefs?.extensions?.settings ?? {};

  // Fall back to the on-disk directory listing when there is no settings map
  // (for example a snapshot copied without Secure Preferences).
  let eligible;
  let excluded;
  if (Object.keys(settings).length > 0) {
    ({ eligible, excluded } = selectMigratableExtensions(settings));
  } else {
    const entries = await readdir(sourceExtensionsDir, { withFileTypes: true });
    eligible = entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'Temp')
      .map((entry) => entry.name);
    excluded = [];
  }

  for (const { id, reason } of excluded) {
    skipped.push({ type: 'extensions', item: id, reason });
  }

  const targetExtensionsDir = path.join(targetProfileDir, 'Extensions');
  const migratedSettings = {};
  let migrated = 0;
  for (const id of eligible) {
    const copied = await copyExtensionFiles(
      sourceExtensionsDir,
      targetExtensionsDir,
      id
    );
    if (!copied) {
      skipped.push({ type: 'extensions', item: id, reason: 'files-missing' });
      continue;
    }
    if (settings[id]) {
      migratedSettings[id] = settings[id];
    }
    migrated += 1;
  }

  if (migrated > 0) {
    // Best-effort: write the settings entries into the target Secure
    // Preferences so Chrome knows about the extensions. The MAC will not
    // validate for the target profile (see the module comment), so warn.
    if (Object.keys(migratedSettings).length > 0) {
      const targetSecurePath = path.join(targetProfileDir, SECURE_PREFERENCES);
      const targetSecure = (await readJsonIfPresent(targetSecurePath)) ?? {};
      targetSecure.extensions ??= {};
      targetSecure.extensions.settings = {
        ...(targetSecure.extensions.settings ?? {}),
        ...migratedSettings,
      };
      await mkdir(targetProfileDir, { recursive: true });
      await writeFile(targetSecurePath, JSON.stringify(targetSecure));
    }
    warnings.push({
      type: 'extensions',
      item: 'Secure Preferences MAC',
      reason: 'mac-will-not-validate',
      detail:
        'Extension files and settings were copied, but Chrome computes a per-profile HMAC over Secure Preferences that cannot be reproduced for the target profile. Chrome will likely disable the migrated extensions on first launch; re-enable them or reinstall from the Web Store to restore a valid MAC.',
    });
  }

  return { migrated, skipped, warnings };
}
