/**
 * Page init script for the fingerprint surfaces CDP cannot override.
 *
 * Everything here is strictly worse than a browser-enforced override: a
 * JavaScript patch is visible to anyone who inspects the property descriptor
 * carefully enough, and it does not reach workers or HTTP headers. It exists
 * only for fields the `Emulation` domain has no command for -- see
 * `limitations.js` for the measured list -- and for `connectBrowser`, where the
 * launch switches were already fixed by whoever started the browser.
 *
 * The payload itself lives in `init-payload.js` and is read as source text
 * rather than serialized from a function in this file, because Python and Rust
 * run the same bytes. `String(fn)` has no equivalent there, and a hand
 * translation of a patch this delicate would drift within a release.
 */
import { readFileSync } from 'node:fs';

/** The shared payload source, read once at import time. */
export const FINGERPRINT_PAYLOAD_SOURCE = readFileSync(
  new URL('./init-payload.js', import.meta.url),
  'utf8'
);

const SCREEN_FIELDS = [
  'width',
  'height',
  'availWidth',
  'availHeight',
  'colorDepth',
  'pixelDepth',
];

/**
 * Decide what the init script still has to do once the browser-side overrides
 * have been applied.
 *
 * @param {object} profile Normalized fingerprint profile.
 * @param {object} [options]
 * @param {boolean} [options.patchWebdriver] Force `navigator.webdriver` to
 *   `false` from JavaScript. Only needed when the browser was launched by
 *   somebody else and the automation switches can no longer be changed.
 * @param {boolean} [options.patchLanguages] Also patch `navigator.languages`.
 * @returns {object|null} Config for the payload, or `null` when nothing is left.
 */
export function buildInitScriptConfig(profile, options = {}) {
  const config = {};

  if (options.patchWebdriver) {
    config.webdriver = false;
  }
  if (profile.deviceMemory !== undefined) {
    config.deviceMemory = profile.deviceMemory;
  }
  if (profile.vendor !== undefined) {
    config.vendor = profile.vendor;
  }
  if (profile.doNotTrack !== undefined) {
    config.doNotTrack = profile.doNotTrack;
  }
  if (options.patchLanguages && profile.languages !== undefined) {
    config.languages = [...profile.languages];
  }
  if (profile.webgl !== undefined) {
    config.webgl = { ...profile.webgl };
  }
  if (profile.screen !== undefined) {
    const screen = {};
    for (const field of SCREEN_FIELDS) {
      if (profile.screen[field] !== undefined) {
        screen[field] = profile.screen[field];
      }
    }
    // width and height are already enforced by setDeviceMetricsOverride; the
    // avail*/depth fields are not, so only those need patching.
    delete screen.width;
    delete screen.height;
    if (Object.keys(screen).length > 0) {
      config.screen = screen;
    }
  }

  return Object.keys(config).length > 0 ? config : null;
}

/**
 * Serialize the init script for a profile.
 *
 * @param {object} profile Normalized fingerprint profile.
 * @param {object} [options] See `buildInitScriptConfig`.
 * @returns {string|null} Script source, or `null` when no patching is needed.
 */
export function buildFingerprintInitScript(profile, options = {}) {
  if (!profile || typeof profile !== 'object') {
    throw new TypeError('profile must be a normalized fingerprint profile');
  }
  const config = buildInitScriptConfig(profile, options);
  if (!config) {
    return null;
  }
  // The payload is wrapped in an IIFE so the declaration never becomes a
  // property of the page's global object; a stray `fingerprintPayload` global
  // would be a far louder signal than anything the payload hides.
  return `(() => {\n${FINGERPRINT_PAYLOAD_SOURCE}\nfingerprintPayload(${JSON.stringify(config)});\n})();`;
}
