/**
 * The library functions the CLI dispatcher calls, loaded on first use.
 *
 * Loading lazily keeps `browser-commander version` fast and lets commands
 * whose module is not installed (an optional engine, or a feature shipped by
 * a later release) fail with a JSON error instead of breaking every command.
 * Tests replace any entry through the dispatcher's `dependencies` object.
 */
import { readFile, writeFile } from 'node:fs/promises';

const PACKAGE_JSON = new URL('../../package.json', import.meta.url);

/** Import a module, turning "not installed" into a readable error. */
export async function importOptional(specifier, feature) {
  try {
    return await import(specifier);
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' ||
      error?.code === 'MODULE_NOT_FOUND'
    ) {
      throw new Error(`${feature} is not available: ${error.message}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/** Read the package name and version for `version`. */
export async function readPackageInfo() {
  const { name, version } = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'));
  return { name, version, language: 'js' };
}

/**
 * Render a trace bundle's static viewer, into the bundle by default or to
 * `output`.
 *
 * @param {string} bundlePath
 * @param {string} [output]
 * @returns {Promise<string>} The written file
 */
export async function writeTraceViewer(bundlePath, output) {
  const viewer = await import('../traces/viewer.js');
  if (!output) {
    return await viewer.writeTraceViewer(bundlePath);
  }
  const { readTrace } = await import('../traces/reader.js');
  const document = await viewer.renderTraceViewer(await readTrace(bundlePath));
  await writeFile(output, document);
  return output;
}

/** Default implementations; every entry is a zero-coupling async function. */
export const DEFAULT_DEPENDENCIES = Object.freeze({
  packageInfo: readPackageInfo,
  launchBrowser: async (options) =>
    (await import('../browser/launcher.js')).launchBrowser(options),
  connectBrowser: async (options) =>
    (await import('../browser/connector.js')).connectBrowser(options),
  startTrace: async (options) =>
    (await import('../traces/recorder.js')).startTrace(options),
  writeTraceViewer,
  readBrowserCookies: async (options) =>
    (await import('../browser/browser-cookies.js')).readBrowserCookies(options),
  loadEngine: (name) => importOptional(name, `The ${name} engine`),
  openInUserBrowser: async (url) =>
    (
      await importOptional(
        '../browser/open-in-user-browser.js',
        'open (openInUserBrowser)'
      )
    ).openInUserBrowser(url),
  migrateProfile: async (options) =>
    (
      await importOptional(
        '../browser/migration/index.js',
        'profile migrate (migrateProfile)'
      )
    ).migrateProfile(options),
  snapshotUserDataDir: async (options) =>
    (
      await importOptional(
        '../browser/attach/snapshot.js',
        'profile snapshot (snapshotUserDataDir)'
      )
    ).snapshotUserDataDir(options),
  attachUserBrowser: async (options) =>
    (
      await importOptional(
        '../browser/attach/index.js',
        'attach (attachUserBrowser)'
      )
    ).attachUserBrowser(options),
  measureParity: async (options) =>
    (
      await importOptional('../browser/parity.js', 'doctor (measureParity)')
    ).measureParity(options),
});
