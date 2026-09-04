/**
 * What Browser Commander cannot make identical, and why.
 *
 * Issue 79 asks for the limitations to be stated clearly rather than implied,
 * so every entry here names the surface, the mechanism that would be needed,
 * the privacy consequence, and the evidence it rests on. Entries marked
 * `measured` were reproduced in this repository; the artifacts are under
 * `docs/case-studies/issue-79/analysis-artifacts/`.
 *
 * The catalogue itself lives in `limitations.json`, because Python and Rust
 * publish the same eleven entries and a hand-copied paragraph of prose drifts
 * as easily as a hand-copied patch. This module owns the JSON; the copies are
 * checked byte for byte by `scripts/check-shared-fingerprint-assets.sh`.
 *
 * `severity` describes how much the limitation helps someone identify the
 * browser as automated or as a specific machine:
 * - `high`: on its own it identifies automation or the physical machine.
 * - `medium`: it is a strong signal when combined with others.
 * - `low`: it narrows the field but is common in real browsers too.
 */
import { readFileSync } from 'node:fs';

/**
 * @typedef {object} FingerprintLimitation
 * @property {string} id Stable identifier.
 * @property {string} surface What the page can observe.
 * @property {'high'|'medium'|'low'} severity
 * @property {'measured'|'documented'} evidence
 * @property {string} detail What happens and why it cannot be fixed here.
 * @property {string} [workaround] What a caller can do about it.
 * @property {string} [reference] Artifact, source file or specification.
 */

/** @type {ReadonlyArray<FingerprintLimitation>} */
export const FINGERPRINT_LIMITATIONS = Object.freeze(
  JSON.parse(
    readFileSync(new URL('./limitations.json', import.meta.url), 'utf8')
  ).map((limitation) => Object.freeze(limitation))
);

/**
 * Look a limitation up by id.
 *
 * @param {string} id
 * @returns {FingerprintLimitation|undefined}
 */
export function findFingerprintLimitation(id) {
  return FINGERPRINT_LIMITATIONS.find((limitation) => limitation.id === id);
}

/**
 * Limitations that apply to a specific profile.
 *
 * A profile that never touches WebGL does not need to hear about the WebGL
 * limitation, and hiding the irrelevant entries is what makes the relevant ones
 * worth reading.
 *
 * @param {object} profile Normalized fingerprint profile.
 * @param {object} [options]
 * @param {boolean} [options.headless] Whether the browser runs headless.
 * @param {boolean} [options.attached] Whether the browser was launched by
 *   somebody else, so the automation switches are already fixed.
 * @returns {ReadonlyArray<FingerprintLimitation>}
 */
export function relevantFingerprintLimitations(profile = {}, options = {}) {
  const always = new Set([
    'canvas-audio-font-follow-the-host',
    'network-layer-not-covered',
  ]);
  const conditions = {
    'automation-controlled-is-launch-only': () => options.attached === true,
    'no-cdp-device-memory-override': () => profile.deviceMemory !== undefined,
    'no-cdp-vendor-or-dnt-override': () =>
      profile.vendor !== undefined || profile.doNotTrack !== undefined,
    'screen-depth-and-avail-not-emulated': () =>
      profile.screen !== undefined &&
      (profile.screen.colorDepth !== undefined ||
        profile.screen.pixelDepth !== undefined ||
        profile.screen.availWidth !== undefined ||
        profile.screen.availHeight !== undefined),
    'webgl-strings-only': () => profile.webgl !== undefined,
    'grease-brand-not-reproduced': () => profile.userAgentData !== undefined,
    'touch-emulation-changes-pointer-media': () =>
      profile.maxTouchPoints !== undefined && profile.maxTouchPoints > 0,
    'headless-is-distinguishable': () => options.headless === true,
    // Everything a worker reads differently from its document: the fields no
    // override reaches, plus the ones the page session keeps to itself.
    'init-script-does-not-reach-workers': () =>
      [
        'deviceMemory',
        'vendor',
        'doNotTrack',
        'webgl',
        'platform',
        'languages',
        'hardwareConcurrency',
      ].some((field) => profile[field] !== undefined),
  };

  return Object.freeze(
    FINGERPRINT_LIMITATIONS.filter(
      (limitation) =>
        always.has(limitation.id) ||
        (conditions[limitation.id] ? conditions[limitation.id]() : false)
    )
  );
}
