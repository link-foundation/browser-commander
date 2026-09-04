/**
 * What Browser Commander cannot make identical, and why.
 *
 * Issue 79 asks for the limitations to be stated clearly rather than implied,
 * so every entry here names the surface, the mechanism that would be needed,
 * the privacy consequence, and the evidence it rests on. Entries marked
 * `measured` were reproduced in this repository; the artifacts are under
 * `docs/case-studies/issue-79/analysis-artifacts/`.
 *
 * `severity` describes how much the limitation helps someone identify the
 * browser as automated or as a specific machine:
 * - `high`: on its own it identifies automation or the physical machine.
 * - `medium`: it is a strong signal when combined with others.
 * - `low`: it narrows the field but is common in real browsers too.
 */

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
export const FINGERPRINT_LIMITATIONS = Object.freeze([
  Object.freeze({
    id: 'automation-controlled-is-launch-only',
    surface: 'navigator.webdriver',
    severity: 'high',
    evidence: 'measured',
    detail:
      'navigator.webdriver is the AutomationControlled Blink runtime feature. ' +
      'Chrome enables it for --enable-automation, --headless, ' +
      '--remote-debugging-pipe and an ephemeral --remote-debugging-port=0, and ' +
      'the only way to turn it back off is the launch switch ' +
      '--disable-blink-features=AutomationControlled. ' +
      'Emulation.setAutomationOverride({enabled:false}) is accepted over CDP ' +
      'but leaves navigator.webdriver true, in the same document and after ' +
      'navigation, so a browser somebody else already launched cannot be ' +
      'corrected from the protocol side.',
    workaround:
      'Launch through launchBrowser, which passes the switch. When attaching ' +
      'to an existing browser, applyFingerprint({ patchWebdriver: true }) ' +
      'installs a JavaScript getter instead, which is weaker: it does not ' +
      'reach workers or a renderer that starts before the patch is installed.',
    reference:
      'content/child/runtime_features.cc; analysis-artifacts/remote-debugging-isolation.json',
  }),
  Object.freeze({
    id: 'no-cdp-device-memory-override',
    surface: 'navigator.deviceMemory',
    severity: 'medium',
    evidence: 'measured',
    detail:
      'The Emulation domain has no deviceMemory command, so the value can only ' +
      'be patched in JavaScript. Workers and any code that reads the value ' +
      'before the init script runs still see the real amount of memory, ' +
      'rounded to the nearest power of two as the specification requires.',
    workaround:
      'Choose a profile whose deviceMemory matches the host where possible.',
    reference: 'analysis-artifacts/cdp-override-coverage.json',
  }),
  Object.freeze({
    id: 'no-cdp-vendor-or-dnt-override',
    surface: 'navigator.vendor, navigator.doNotTrack',
    severity: 'low',
    evidence: 'measured',
    detail:
      'Neither has an Emulation command; both are JavaScript patches only. ' +
      'navigator.vendor is "Google Inc." on every Chromium build, so it rarely ' +
      'needs changing, but a profile that claims a non-Chromium browser has to ' +
      'patch it and the patch does not reach workers.',
    reference: 'analysis-artifacts/cdp-override-coverage.json',
  }),
  Object.freeze({
    id: 'screen-depth-and-avail-not-emulated',
    surface:
      'screen.colorDepth, screen.pixelDepth, screen.availWidth, screen.availHeight',
    severity: 'low',
    evidence: 'measured',
    detail:
      'Emulation.setDeviceMetricsOverride controls screen.width and ' +
      'screen.height only. It sets availWidth and availHeight equal to them, ' +
      'so a profile that models an operating system taskbar has to patch those ' +
      'in JavaScript, and the colour depths are not emulated at all.',
    reference: 'analysis-artifacts/cdp-override-coverage.json',
  }),
  Object.freeze({
    id: 'webgl-strings-only',
    surface: 'WebGL renderer strings and driver limits',
    severity: 'high',
    evidence: 'documented',
    detail:
      'The unmasked vendor and renderer strings can be replaced in JavaScript, ' +
      'but the numeric driver limits next to them -- MAX_TEXTURE_SIZE, ' +
      'ALIASED_LINE_WIDTH_RANGE, the bit depths, the supported extension list ' +
      '-- come from the real GPU stack. Claiming an Apple GPU while reporting ' +
      "Mesa's limits is more identifying than not claiming anything.",
    workaround:
      'Either leave the WebGL strings alone or run on hardware that matches ' +
      'the profile you are claiming.',
  }),
  Object.freeze({
    id: 'canvas-audio-font-follow-the-host',
    surface: 'canvas and audio digests, font metrics',
    severity: 'high',
    evidence: 'documented',
    detail:
      'These are produced by the host GPU, audio stack and installed fonts. ' +
      'Browser Commander does not perturb them, because the usual ' +
      'countermeasure -- adding per-session noise -- is itself detectable: a ' +
      'real browser returns the same digest twice in a row, and a noised one ' +
      'does not.',
    workaround:
      'Match the host environment to the profile, for example by running in a ' +
      'container image with the font set you intend to claim.',
  }),
  Object.freeze({
    id: 'grease-brand-not-reproduced',
    surface: 'navigator.userAgentData.brands ordering',
    severity: 'low',
    evidence: 'documented',
    detail:
      'Chrome generates the GREASE entry in Sec-CH-UA from a per-version ' +
      'permutation of separators and ordering. Derived profiles use the common ' +
      '"Not=A?Brand";v="24" form in a fixed position, which will not match ' +
      'every Chrome build exactly.',
    workaround:
      'Pass an explicit userAgentData.brands copied from the browser build you ' +
      'are modelling.',
    reference: 'https://wicg.github.io/ua-client-hints/',
  }),
  Object.freeze({
    id: 'touch-emulation-changes-pointer-media',
    surface: '(pointer) and (hover) media queries',
    severity: 'medium',
    evidence: 'measured',
    detail:
      'Setting maxTouchPoints above zero goes through ' +
      'Emulation.setTouchEmulationEnabled, which also makes the primary ' +
      'pointer coarse and removes hover. That is correct for a phone and wrong ' +
      'for a desktop that happens to have a touchscreen.',
    workaround:
      'Leave maxTouchPoints unset on desktop profiles unless the pointer ' +
      'change is what you want.',
    reference: 'analysis-artifacts/cdp-override-coverage.json',
  }),
  Object.freeze({
    id: 'headless-is-distinguishable',
    surface:
      'user agent, screen size, hover and pointer media queries, WebGL renderer',
    severity: 'high',
    evidence: 'measured',
    detail:
      'A real headless Chrome differs from a real headful Chrome in twelve ' +
      'probe fields with no automation involved at all: the user agent and ' +
      'appVersion contain "HeadlessChrome", the screen is 800x600, the four ' +
      'hover and pointer media queries report no hover and no fine pointer, ' +
      'and WebGL falls back to SwiftShader. Parity is therefore defined ' +
      'against a headful browser.',
    workaround: 'Run headful, under a virtual display such as Xvfb if needed.',
    reference: 'analysis-artifacts/parity-headless.json',
  }),
  Object.freeze({
    id: 'network-layer-not-covered',
    surface: 'TLS and HTTP/2 fingerprints (JA3, JA4, Akamai h2 fingerprint)',
    severity: 'high',
    evidence: 'documented',
    detail:
      'The TLS ClientHello and the HTTP/2 SETTINGS frame identify the network ' +
      'stack, not the JavaScript environment, and CDP exposes no way to change ' +
      'either. They are identical between a real Chrome and an automated ' +
      'Chrome of the same build, so they are not an automation signal -- but ' +
      'they do pin the browser to a real Chrome version, and a profile that ' +
      'claims a different browser or version will not match at that layer.',
    workaround:
      'Keep the claimed browser and version close to the browser actually ' +
      'running.',
  }),
  Object.freeze({
    id: 'init-script-does-not-reach-workers',
    surface: 'Values patched in JavaScript, as seen from a Worker',
    severity: 'medium',
    evidence: 'measured',
    detail:
      'A worker has its own Navigator, and overrides set on the page session ' +
      'only partly reach it. Measured in a dedicated worker: userAgent, ' +
      'timezone and locale follow the profile, but platform, language, ' +
      'languages, hardwareConcurrency and deviceMemory all report the real ' +
      'host values, and no JavaScript patch is present because ' +
      'Page.addScriptToEvaluateOnNewDocument runs in documents only. Full ' +
      'worker parity is reachable over raw CDP -- replaying the Emulation ' +
      'commands on the worker session fixes languages and hardwareConcurrency, ' +
      'and evaluating the init script during the waitForDebuggerOnStart pause ' +
      'fixes the rest -- but that needs a sessionId, which neither engine ' +
      'accepts: Playwright newCDPSession takes only Page or Frame, and ' +
      'Puppeteer worker sessions are internal to its TargetManager.',
    workaround:
      'Avoid workloads that read the fingerprint from a worker, or drive ' +
      'Chrome over a raw CDP connection and replay the commands returned by ' +
      'buildCdpEmulationCommands on each attached worker session.',
    reference: 'analysis-artifacts/worker-visibility.json',
  }),
]);

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
