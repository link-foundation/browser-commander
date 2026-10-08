/**
 * Resolve the operating-system default web browser to a canonical browser id
 * from the shared catalogue (#114), so `browser: 'default'` imports from
 * whichever browser a person actually uses.
 *
 * Each platform records the default differently:
 *
 * - macOS keeps it in the LaunchServices database as the `https` URL-scheme
 *   handler's bundle id (`defaults read
 *   com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers`).
 * - Linux reports it through `xdg-settings get default-web-browser` (a
 *   `.desktop` file name), falling back to the `x-scheme-handler/https`
 *   association from `xdg-mime`.
 * - Windows stores the `https` UserChoice ProgId under
 *   `HKCU\...\UrlAssociations\https\UserChoice`.
 *
 * Every lookup runs through an injected command runner so the resolver is
 * deterministic in tests, and the raw identifier is matched against the
 * `default` identifiers each browser declares in `browser-sources.json`.
 */
import { runCommand as runSubprocess } from '../utilities/subprocess.js';
import { BROWSER_SOURCES } from './browser-sources.js';

async function defaultRunCommand(command, args, environment) {
  const { stdout } = await runSubprocess(command, args, {
    env: environment,
    check: false,
  });
  return stdout;
}

/**
 * Match a raw OS identifier (bundle id, `.desktop` name or ProgId) to a
 * canonical browser id. Comparison is case-insensitive because the registry
 * and the operating systems disagree on casing.
 */
function browserForIdentifier(identifier, platform) {
  if (!identifier) {
    return null;
  }
  const needle = identifier.trim().toLowerCase();
  if (!needle) {
    return null;
  }
  for (const source of BROWSER_SOURCES) {
    const identifiers = source.default?.[platform] ?? [];
    if (identifiers.some((candidate) => candidate.toLowerCase() === needle)) {
      return source.id;
    }
  }
  return null;
}

function parseMacLaunchServicesHandler(output) {
  // `defaults read` prints NeXTSTEP-style plist text; each handler is a brace
  // block that may carry an LSHandlerURLScheme and an LSHandlerRoleAll bundle
  // id. Find the block that handles https and read its bundle id.
  for (const block of output.split('}')) {
    if (!/LSHandlerURLScheme\s*=\s*"?https"?\s*;/.test(block)) {
      continue;
    }
    const match = /LSHandlerRoleAll\s*=\s*"?([^";]+)"?\s*;/.exec(block);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

async function resolveDarwinDefault(runCommand, environment) {
  const output = await Promise.resolve()
    .then(() =>
      runCommand(
        'defaults',
        [
          'read',
          'com.apple.LaunchServices/com.apple.launchservices.secure',
          'LSHandlers',
        ],
        environment
      )
    )
    .catch(() => '');
  const legacy = browserForIdentifier(
    parseMacLaunchServicesHandler(output),
    'darwin'
  );
  if (legacy) {
    return legacy;
  }
  try {
    const script =
      "ObjC.import('AppKit'); var app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString('https://example.invalid')); app ? ObjC.unwrap($.NSBundle.bundleWithURL(app).bundleIdentifier) : ''";
    return browserForIdentifier(
      await runCommand(
        'osascript',
        ['-l', 'JavaScript', '-e', script],
        environment
      ),
      'darwin'
    );
  } catch {
    return null;
  }
}

async function resolveLinuxDefault(runCommand, environment) {
  let desktop = '';
  try {
    desktop = (
      await runCommand(
        'xdg-settings',
        ['get', 'default-web-browser'],
        environment
      )
    ).trim();
  } catch {
    // xdg-settings may be absent; fall through to the xdg-mime query.
  }
  let resolved = browserForIdentifier(desktop, 'linux');
  if (resolved) {
    return resolved;
  }
  try {
    const fallback = (
      await runCommand(
        'xdg-mime',
        ['query', 'default', 'x-scheme-handler/https'],
        environment
      )
    ).trim();
    resolved = browserForIdentifier(fallback, 'linux');
  } catch {
    resolved = null;
  }
  return resolved;
}

function parseWindowsProgId(output) {
  // `reg query` prints `    ProgId    REG_SZ    FirefoxHTML`; take the last
  // whitespace-separated token of the ProgId line.
  for (const line of output.split(/\r?\n/)) {
    if (/\bProgId\b/i.test(line)) {
      const tokens = line.trim().split(/\s+/);
      return tokens[tokens.length - 1];
    }
  }
  return null;
}

async function resolveWindowsDefault(runCommand, environment) {
  let output;
  try {
    output = await runCommand(
      'reg',
      [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
        '/v',
        'ProgId',
      ],
      environment
    );
  } catch {
    return null;
  }
  return browserForIdentifier(parseWindowsProgId(output), 'win32');
}

/**
 * Resolve the system default browser to a canonical catalogue id.
 *
 * @param {Object} [options]
 * @param {string} [options.platform=process.platform]
 * @param {Object<string,string>} [options.environment=process.env]
 * @param {Function} [options.runCommand] - `(command, args, env) => stdout`
 * @returns {Promise<string|null>} The browser id, or null when it cannot be resolved
 */
export async function resolveDefaultBrowser({
  platform = process.platform,
  environment = process.env,
  runCommand = defaultRunCommand,
} = {}) {
  if (platform === 'darwin') {
    return await resolveDarwinDefault(runCommand, environment);
  }
  if (platform === 'linux') {
    return await resolveLinuxDefault(runCommand, environment);
  }
  if (platform === 'win32') {
    return await resolveWindowsDefault(runCommand, environment);
  }
  return null;
}

export {
  browserForIdentifier,
  parseMacLaunchServicesHandler,
  parseWindowsProgId,
};
