import { openInUserBrowser } from '../open-in-user-browser.js';
import { launchRealBrowser } from '../real-browser.js';
import { ATTACH_MODES, describeAttachDifferences } from './differences.js';
import { attachViaExtension } from './extension-relay.js';

export { ATTACH_MODES, describeAttachDifferences } from './differences.js';
export {
  attachViaExtension,
  checkRelayUpgrade,
  DEFAULT_RELAY_PORT,
  EXTENSION_DIRECTORY,
  extensionIdFromOrigin,
  RELAY_PATH,
} from './extension-relay.js';
export {
  isSqliteFile,
  snapshotSkipReason,
  snapshotUserDataDir,
} from './snapshot.js';
export { snapshotBrowserForChannel } from './snapshot-launch.js';

/**
 * Reach the user's real browser in one of the issue #102 addendum modes. Each
 * result carries `differences`: the documented ways the mode differs from the
 * real browser, see {@link describeAttachDifferences}.
 *
 * - `snapshot`: {@link launchRealBrowser} on a read-only copy of a real
 *   profile. Options are launch options plus `browser`, `profile` and
 *   `userDataDir` (the source), which become `attach`. Returns the launched
 *   session with `mode`, `differences` and the `attach` report.
 * - `extension`: {@link attachViaExtension} - drive tabs of the running
 *   browser through the companion extension. Options: `port`, `host`,
 *   `timeoutMs`, `allowedExtensionIds`, `onListening`.
 * - `open`: {@link openInUserBrowser} - open `url` in the user's default
 *   browser without automation. Returns `{mode, opened, command,
 *   differences}`.
 *
 * @param {Object} options
 * @param {'snapshot'|'extension'|'open'} options.mode
 * @param {Object} [dependencies] - Test seams: launchRealBrowser, attachViaExtension, openInUserBrowser
 * @returns {Promise<Object>}
 */
export async function attachUserBrowser(options = {}, dependencies = {}) {
  const { mode, ...rest } = options;
  switch (mode) {
    case 'snapshot': {
      const { browser, profile, userDataDir, ...launchOptions } = rest;
      const launch = dependencies.launchRealBrowser ?? launchRealBrowser;
      const session = await launch({
        ...launchOptions,
        attach: { mode: 'snapshot', browser, profile, userDataDir },
      });
      return {
        ...session,
        mode: 'snapshot',
        differences: describeAttachDifferences('snapshot'),
      };
    }
    case 'extension': {
      const attach = dependencies.attachViaExtension ?? attachViaExtension;
      return await attach(rest);
    }
    case 'open': {
      const { url, ...openOptions } = rest;
      if (typeof url !== 'string' || url === '') {
        throw new TypeError('attachUserBrowser open mode requires a url');
      }
      const open = dependencies.openInUserBrowser ?? openInUserBrowser;
      const result = await open(url, openOptions);
      return {
        mode: 'open',
        ...result,
        differences: describeAttachDifferences('open'),
      };
    }
    default:
      throw new TypeError(
        `Unknown attach mode "${mode}"; expected snapshot, extension or open (${ATTACH_MODES.join(', ')} are described by describeAttachDifferences)`
      );
  }
}
