/**
 * What each way of reaching "the user's real browser" differs in from that
 * browser (issue #102, addendum).
 *
 * Chrome 136 and later ignore the remote debugging switches for the default
 * user data directory, so no mode can drive the real profile in place. Each
 * mode trades something else away, and consumers pick knowingly from these
 * lists:
 *
 * - `clean`: the default `launchRealBrowser()` - a fresh dedicated profile.
 * - `snapshot`: `launchRealBrowser({ attach: { mode: 'snapshot' } })` - a
 *   read-only copy of the real profile in a temporary user data directory.
 * - `extension`: `attachUserBrowser({ mode: 'extension' })` - the running real
 *   browser, driven through the companion extension's `chrome.debugger` API.
 * - `open`: `openInUserBrowser(url)` - the user's own browser with no
 *   automation at all, so there is nothing that differs.
 *
 * Every entry is `{ aspect, description }`; `aspect` is a stable identifier
 * shared by the JS, Python and Rust implementations. The lists are static:
 * what a page can actually observe is measured by `measureParity()` (issue
 * #103), which the `fingerprint` entry points to.
 */

/** The modes {@link describeAttachDifferences} knows. */
export const ATTACH_MODES = Object.freeze([
  'clean',
  'snapshot',
  'extension',
  'open',
]);

const REMOTE_DEBUGGING = {
  aspect: 'remote-debugging',
  description:
    'A fixed loopback --remote-debugging-port is on the command line; issue #101 measured that a page cannot observe it and that navigator.webdriver stays false.',
};

const FINGERPRINT = {
  aspect: 'fingerprint',
  description:
    'measureParity({ session }) measures the command line and everything a page can read against the same browser started by hand.',
};

const DIFFERENCES = {
  clean: [
    {
      aspect: 'user-data-dir',
      description:
        'A fresh dedicated profile: no cookies, sign-in, history, bookmarks, passwords or extensions of the real profile. Signing in with Google works (#101) and Chrome sync restores the rest.',
    },
    {
      aspect: 'first-run',
      description:
        "The profile gets Chrome's own First Run sentinel and a Local State that skips the What's New and Edge first-run tabs, instead of --no-first-run.",
    },
    REMOTE_DEBUGGING,
    FINGERPRINT,
  ],
  snapshot: [
    {
      aspect: 'user-data-dir',
      description:
        'The browser runs on a read-only copy of the real profile in a temporary user data directory. Changes are not written back, and the copy is deleted on close.',
    },
    {
      aspect: 'profile-directory',
      description:
        'A profile other than Default is selected with --profile-directory=<name>, as a profile shortcut does.',
    },
    {
      aspect: 'not-copied',
      description:
        'Caches (HTTP, code, GPU and shader caches, Service Worker CacheStorage), crash reports, lock files and the open-tabs session files are not copied, so first loads are cold and the tabs of the running browser are not restored.',
    },
    {
      aspect: 'encrypted-data',
      description:
        'Cookies and saved passwords stay encrypted with the OS keystore key and decrypt only for the same browser, and only when neither the mock-keychain nor the basic-password-store restriction is used.',
    },
    {
      aspect: 'dbsc',
      description:
        'Device-bound Google sessions (DBSC) cannot be used from a copy because their key never leaves the original profile; Google needs a fresh sign-in. Other sites keep their sessions.',
    },
    {
      aspect: 'extensions-mac',
      description:
        'Extension settings are protected by a machine-bound MAC in Secure Preferences. The copy is made on the same machine, so they stay valid; a snapshot moved to another machine has its extensions reset by Chrome.',
    },
    REMOTE_DEBUGGING,
    FINGERPRINT,
  ],
  extension: [
    {
      aspect: 'debugger-infobar',
      description:
        'While a tab is attached, Chrome shows its "started debugging this browser" infobar; the user can end the session with its Cancel button.',
    },
    {
      aspect: 'extension-install',
      description:
        'The companion extension (js/extension) has to be installed once with the user\'s consent through chrome://extensions "Load unpacked".',
    },
    {
      aspect: 'cdp-scope',
      description:
        'CDP is limited to what chrome.debugger allows: per-tab sessions only, no Browser.* or Target.* domain commands. New tabs are opened through the extension (tabs.create).',
    },
    {
      aspect: 'data',
      description:
        "None: the profile, cookies, sign-in, extensions and open tabs are the user's own; nothing is copied and there is no debugging switch on the command line.",
    },
  ],
  open: [],
};

/**
 * The documented differences from the real browser for one mode.
 *
 * @param {'clean'|'snapshot'|'extension'|'open'} mode
 * @returns {Array<{aspect: string, description: string}>} A fresh copy
 */
export function describeAttachDifferences(mode) {
  if (!Object.hasOwn(DIFFERENCES, mode)) {
    throw new TypeError(
      `Unknown attach mode "${mode}"; expected one of ${ATTACH_MODES.join(', ')}`
    );
  }
  return DIFFERENCES[mode].map((difference) => ({ ...difference }));
}
