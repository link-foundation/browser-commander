import { runCommand } from '../utilities/subprocess.js';

/**
 * Hand a URL to the operating system's default browser with no automation
 * (issue #102). This is the mode for flows where a consumer only needs the
 * user to see and approve a page - an OAuth screen or a CLI web-login - in the
 * browser where they are already signed in. Nothing is driven, nothing is
 * migrated, and no dedicated profile is created.
 *
 * Each platform has one canonical opener:
 * - macOS: `open <url>`
 * - Linux: `xdg-open <url>` (the freedesktop.org standard launcher)
 * - Windows: `cmd /c start "" <url>` (the empty `""` is `start`'s window-title
 *   argument, so a quoted URL is not mistaken for the title)
 *
 * All of them run through command-stream (issue #104) with exact argv
 * boundaries and no shell in between, so a URL can never be reinterpreted as
 * shell syntax.
 */

/** Platform openers as [file, ...fixedArgs]; the URL is appended last. */
const PLATFORM_OPENERS = {
  darwin: ['open'],
  linux: ['xdg-open'],
  win32: ['cmd', '/c', 'start', ''],
};

/**
 * URL schemes a browser will open. `open`/`xdg-open`/`start` will also happily
 * launch a local application for another scheme, so the set is deliberately
 * limited to what "open this page" means.
 */
const ALLOWED_PROTOCOLS = new Set([
  'http:',
  'https:',
  'file:',
  'ftp:',
  'about:',
  'chrome:',
  'edge:',
  'view-source:',
]);

/**
 * Validate a URL string before it reaches an opener.
 *
 * A bare string that begins with `-` would be parsed by the opener as an
 * option rather than a URL, so it is rejected outright; every other string
 * has to parse as a URL with an allowed scheme.
 *
 * @param {string} url
 * @returns {string} The validated URL
 */
export function validateOpenUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('openInUserBrowser requires a URL string');
  }
  if (url.startsWith('-')) {
    throw new Error(
      `Refusing to open ${JSON.stringify(url)}: a URL cannot start with "-", which an opener would read as an option`
    );
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `Refusing to open ${JSON.stringify(url)}: it is not a valid absolute URL`
    );
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `Refusing to open ${JSON.stringify(url)}: ${parsed.protocol} is not one of ${[...ALLOWED_PROTOCOLS].join(', ')}`
    );
  }
  return url;
}

/**
 * Build the exact command line for the platform's opener.
 *
 * @param {string} url - An already validated URL
 * @param {string} platform - `process.platform` value
 * @returns {string[]} `[file, ...args]`
 */
export function buildOpenCommand(url, platform) {
  const opener = PLATFORM_OPENERS[platform];
  if (!opener) {
    throw new Error(
      `openInUserBrowser is not supported on ${platform}; supported platforms are ${Object.keys(PLATFORM_OPENERS).join(', ')}`
    );
  }
  return [...opener, url];
}

/**
 * Open a URL in the user's default browser with no automation.
 *
 * @param {string} url - The page to open (http/https/file/ftp/about/...)
 * @param {Object} [options]
 * @param {string} [options.platform=process.platform] - Injectable for tests
 * @param {function(string, Array<string>, Object=): Promise<any>} [options.runner=runCommand] - Injectable command runner
 * @param {Object<string,string>} [options.env] - Environment for the opener process
 * @returns {Promise<{opened: string, command: string[]}>} The opened URL and the exact command line used
 */
export async function openInUserBrowser(url, options = {}) {
  const { platform = process.platform, runner = runCommand, env } = options;
  const validated = validateOpenUrl(url);
  const [file, ...args] = buildOpenCommand(validated, platform);
  await runner(file, args, env ? { env } : {});
  return { opened: validated, command: [file, ...args] };
}
