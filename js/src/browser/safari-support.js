import { findBrowserSource } from './browser-sources.js';
import { runCommand } from '../utilities/subprocess.js';

/** Whether a channel (including aliases) selects an installed Safari. */
export function isSafariChannel(channel) {
  return findBrowserSource(channel)?.family === 'safari';
}

/** A requested operation unavailable in Safari's classic WebDriver. */
export class SafariUnsupportedError extends Error {
  constructor(feature) {
    super(`${feature} is unsupported on safari`);
    this.name = 'SafariUnsupportedError';
    this.code = 'SAFARI_UNSUPPORTED';
    this.feature = feature;
  }
}

/** One-time setup failure with actionable instructions and a settings opener. */
export class SafariSetupError extends Error {
  constructor(cause, channel = 'safari') {
    const driver = findBrowserSource(channel).executables.darwin[0];
    super(
      `Safari automation setup required: ${cause.message}. In Safari → Settings → Advanced enable "Show features for web developers", then Develop → "Allow Remote Automation". Run "${driver}" --enable once (an admin password may be required). Call error.openSettings() to open Safari's Advanced settings.`,
      { cause }
    );
    this.name = 'SafariSetupError';
    this.code = 'SAFARI_SETUP_REQUIRED';
    this.channel = channel;
  }
  openSettings() {
    return openSafariSettings({ channel: this.channel });
  }
}

/** Translate only recognizable authorization failures; preserve other errors. */
export function safariLaunchError(error, channel) {
  return /allow\s+remote\s+automation|remote automation.*(?:disabled|enable)|(?:safaridriver|webdriver).*(?:--enable|authoriz|not enabled)|not authorized.*(?:safari|automation)/i.test(
    error.message
  )
    ? new SafariSetupError(error, channel)
    : error;
}

/** Open Advanced settings on explicit request; never change authorization. */
export async function openSafariSettings({
  channel = 'safari',
  platform = process.platform,
  run = runCommand,
} = {}) {
  if (platform !== 'darwin') {
    throw new SafariUnsupportedError('Safari settings outside macOS');
  }
  const app =
    findBrowserSource(channel)?.id === 'safari-technology-preview'
      ? 'Safari Technology Preview'
      : 'Safari';
  return await run('osascript', [
    '-e',
    `tell application "${app}" to activate`,
    '-e',
    `tell application "${app}" to open location "x-safari-preferences:com.apple.Safari.preferences.Advanced"`,
  ]);
}

/** Reject settings Safari cannot apply before touching disk or starting it. */
export function validateSafariOptions(options) {
  for (const name of [
    'headless',
    'userDataDir',
    'attach',
    'migrateFrom',
    'remoteDebuggingPort',
    'cdpEndpoint',
    'wsEndpoint',
    'fingerprint',
    'colorScheme',
    'downloads',
    'bidi',
    'preferences',
    'localState',
    'defaultBrowserCheck',
    'firstRun',
  ]) {
    if (
      options[name] !== undefined &&
      options[name] !== null &&
      options[name] !== false
    ) {
      throw new SafariUnsupportedError(name);
    }
  }
  for (const name of ['args', 'extraArgs', 'restrictions']) {
    if (options[name]?.length) {
      throw new SafariUnsupportedError(name);
    }
  }
}
