import { resolveRestrictions } from '../restrictions.js';
import { describeAttachDifferences } from './differences.js';
import { snapshotUserDataDir } from './snapshot.js';

/**
 * The `attach: { mode: 'snapshot' }` option of `launchRealBrowser()` (issue
 * #102, addendum): validation, the snapshot itself, and the extra switch.
 * Kept apart from real-browser.js so the launcher stays one flow.
 */

/** Switches that make the OS-keystore-encrypted data of a copy unreadable. */
const KEYSTORE_BYPASS_SWITCHES = ['--use-mock-keychain', '--password-store='];

/**
 * The browser whose profile is snapshotted when `attach.browser` is omitted:
 * the one the launch channel belongs to.
 *
 * @param {string} channel - Launch channel such as chrome, msedge-beta or brave
 * @returns {string}
 */
export function snapshotBrowserForChannel(channel) {
  if (channel.startsWith('msedge')) {
    return 'edge';
  }
  if (channel === 'brave' || channel === 'chromium') {
    return channel;
  }
  return 'chrome';
}

/**
 * Reject an `attach` option that the launcher cannot honour, before anything
 * touches the disk.
 *
 * @param {Object} options
 * @param {*} options.attach - The `attach` launch option
 * @param {Object} [options.migrateFrom]
 * @param {string} [options.userDataDir]
 * @param {string[]} [options.customArgs] - args and extraArgs
 * @returns {void}
 * @throws {TypeError}
 */
export function validateAttachOption({
  attach,
  migrateFrom,
  userDataDir,
  customArgs = [],
}) {
  if (attach === undefined) {
    return;
  }
  if (!attach || typeof attach !== 'object' || Array.isArray(attach)) {
    throw new TypeError(
      "attach must be an object such as { mode: 'snapshot', browser: 'chrome' }"
    );
  }
  if (attach.mode !== 'snapshot') {
    throw new TypeError(
      `launchRealBrowser only launches attach mode "snapshot", got ${JSON.stringify(attach.mode)}; use attachUserBrowser({ mode: 'extension' }) or openInUserBrowser(url) for the other modes`
    );
  }
  if (migrateFrom) {
    throw new TypeError(
      'attach and migrateFrom are mutually exclusive: a snapshot already copies the whole profile'
    );
  }
  if (userDataDir) {
    throw new TypeError(
      'attach and userDataDir are mutually exclusive: a snapshot is launched from its own temporary user data directory'
    );
  }
  if (
    customArgs.some(
      (argument) =>
        argument === '--profile-directory' ||
        argument.startsWith('--profile-directory=')
    )
  ) {
    throw new TypeError(
      '--profile-directory is managed by the snapshot attach mode; pass attach.profile instead'
    );
  }
}

function keystoreWarnings({ restrictions, customArgs }) {
  const switches = [...resolveRestrictions(restrictions).args, ...customArgs];
  return switches
    .filter((argument) =>
      KEYSTORE_BYPASS_SWITCHES.some((bypass) => argument.startsWith(bypass))
    )
    .filter((argument) => argument !== '--password-store=detect')
    .map((argument) => ({
      item: argument,
      reason: 'encrypted-data-unreadable',
      detail: `${argument} bypasses the OS keystore, so the copied cookies and saved passwords cannot be decrypted and the snapshot starts signed out`,
    }));
}

/**
 * Snapshot the real profile into a new temporary user data directory for a
 * launch.
 *
 * @param {Object} options
 * @param {{mode: 'snapshot', browser: (string|undefined), profile: (string|undefined), userDataDir: (string|undefined)}} options.attach
 * @param {string} options.channel - Launch channel
 * @param {string[]} options.restrictions
 * @param {string[]} options.customArgs - args and extraArgs
 * @param {function(Object): Promise<Object>} [options.snapshot=snapshotUserDataDir]
 * @returns {Promise<{userDataDir: string, args: string[], attach: {mode: 'snapshot', snapshot: Object, differences: Array<Object>}}>}
 *   The snapshot directory, the switches to put before the custom args, and the `attach` result entry
 */
export async function prepareSnapshotLaunch({
  attach,
  channel,
  restrictions,
  customArgs,
  snapshot = snapshotUserDataDir,
}) {
  const browser = attach.browser ?? snapshotBrowserForChannel(channel);
  const profile = attach.profile ?? 'Default';
  const report = await snapshot({
    browser,
    profile,
    userDataDir: attach.userDataDir,
  });
  const warnings = [
    ...(report.warnings ?? []),
    ...keystoreWarnings({ restrictions, customArgs }),
  ];
  if (report.source.browser !== snapshotBrowserForChannel(channel)) {
    warnings.push({
      item: channel,
      reason: 'browser-mismatch',
      detail: `A ${report.source.browser} profile launched in ${channel} cannot decrypt its cookies and saved passwords`,
    });
  }
  return {
    userDataDir: report.target,
    args: profile === 'Default' ? [] : [`--profile-directory=${profile}`],
    attach: {
      mode: 'snapshot',
      snapshot: { ...report, warnings },
      differences: describeAttachDifferences('snapshot'),
    },
  };
}
