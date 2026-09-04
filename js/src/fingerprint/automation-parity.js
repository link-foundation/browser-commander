/**
 * Chrome tells a page that it is automated through exactly one Blink runtime
 * feature: `AutomationControlled`. `navigator.webdriver` is that feature and
 * nothing else, so closing the gap between a hand-started Chrome and a
 * Browser Commander Chrome is a matter of knowing which switches turn it on.
 *
 * `content/child/runtime_features.cc` in Chromium maps switches onto the
 * feature in `SetRuntimeFeaturesFromCommandLine`:
 *
 *     {wrf::EnableAutomationControlled, switches::kEnableAutomation, true},
 *     {wrf::EnableAutomationControlled, switches::kHeadless, true},
 *     {wrf::EnableAutomationControlled, switches::kRemoteDebuggingPipe, true},
 *
 * plus a special case directly below it: `--remote-debugging-port=0` also
 * enables the feature, because an ephemeral port is how ChromeDriver launches
 * the browser. A specific port number is left alone on purpose, since that is
 * what a human attaching a debugger passes.
 *
 * https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/child/runtime_features.cc
 */

/** Switch that disables the Blink feature regardless of what turned it on. */
export const AUTOMATION_CONTROLLED_OFF_ARG =
  '--disable-blink-features=AutomationControlled';

/** Chrome switches that enable the `AutomationControlled` Blink feature. */
export const AUTOMATION_CONTROLLED_TRIGGERS = Object.freeze([
  Object.freeze({
    switch: '--enable-automation',
    reason:
      'Mapped onto AutomationControlled in content/child/runtime_features.cc; also shows the "controlled by automated test software" infobar.',
  }),
  Object.freeze({
    switch: '--headless',
    reason:
      'Mapped onto AutomationControlled in content/child/runtime_features.cc; covers --headless and --headless=new alike.',
  }),
  Object.freeze({
    switch: '--remote-debugging-pipe',
    reason:
      'Mapped onto AutomationControlled in content/child/runtime_features.cc. Playwright always passes it, and Puppeteer passes it whenever pipe transport is selected.',
  }),
  Object.freeze({
    switch: '--remote-debugging-port=0',
    reason:
      'An ephemeral debugging port is how ChromeDriver launches Chrome, so runtime_features.cc treats it as automation. A fixed non-zero port is deliberately not treated that way. Puppeteer defaults to port 0.',
  }),
]);

function switchName(argument) {
  const separator = argument.indexOf('=');
  return separator === -1 ? argument : argument.slice(0, separator);
}

function isTrigger(argument, trigger) {
  if (trigger.switch === '--remote-debugging-port=0') {
    return (
      switchName(argument) === '--remote-debugging-port' &&
      Number(argument.slice('--remote-debugging-port='.length)) === 0
    );
  }
  if (trigger.switch === '--headless') {
    return switchName(argument) === '--headless';
  }
  return switchName(argument) === trigger.switch;
}

/**
 * Report which of the supplied Chrome switches would make `navigator.webdriver`
 * true, so callers can explain a parity failure instead of only observing it.
 *
 * @param {string[]} args Chrome command line switches.
 * @returns {Array<{switch: string, argument: string, reason: string}>} Triggers found.
 */
export function detectAutomationControlledTriggers(args = []) {
  if (!Array.isArray(args)) {
    throw new TypeError('args must be an array of strings');
  }
  const found = [];
  for (const argument of args) {
    if (typeof argument !== 'string') {
      throw new TypeError('args must be an array of strings');
    }
    for (const trigger of AUTOMATION_CONTROLLED_TRIGGERS) {
      if (isTrigger(argument, trigger)) {
        found.push({
          switch: trigger.switch,
          argument,
          reason: trigger.reason,
        });
      }
    }
  }
  return found;
}

/** True when the switch list already disables the AutomationControlled feature. */
export function disablesAutomationControlled(args = []) {
  return args.some((argument) => {
    if (switchName(argument) !== '--disable-blink-features') {
      return false;
    }
    return argument
      .slice('--disable-blink-features='.length)
      .split(',')
      .some((feature) => feature.trim() === 'AutomationControlled');
  });
}

/**
 * Append the switch that keeps `navigator.webdriver` false.
 *
 * The feature is disabled rather than the triggering switches removed: an
 * engine adds `--remote-debugging-pipe` or `--remote-debugging-port=0` after
 * the caller's arguments and needs that transport to work at all, so the only
 * reliable place to intervene is the feature itself.
 *
 * @param {string[]} args Chrome switches assembled so far.
 * @returns {string[]} Switches with automation parity applied.
 */
export function applyAutomationParityArgs(args = []) {
  if (!Array.isArray(args)) {
    throw new TypeError('args must be an array of strings');
  }
  if (disablesAutomationControlled(args)) {
    return [...args];
  }
  const existingIndex = args.findIndex(
    (argument) => switchName(argument) === '--disable-blink-features'
  );
  if (existingIndex === -1) {
    return [...args, AUTOMATION_CONTROLLED_OFF_ARG];
  }
  // Chrome keeps only the last --disable-blink-features occurrence, so the
  // existing feature list has to be extended in place rather than duplicated.
  const merged = [...args];
  merged[existingIndex] = `${args[existingIndex]},AutomationControlled`;
  return merged;
}

/**
 * Playwright forces a mouse-like pointer in headless Chrome:
 *
 *     if (options.headless) {
 *       chromeArguments.push("--headless");
 *       chromeArguments.push(
 *         "--hide-scrollbars",
 *         "--mute-audio",
 *         "--blink-settings=primaryHoverType=2,availableHoverTypes=2," +
 *           "primaryPointerType=4,availablePointerTypes=4");
 *     }
 *
 * -- packages/playwright-core/src/server/chromium/chromium.ts. Headless Chrome
 * has no pointing device, so a real headless browser answers `hover: none` and
 * `pointer: none`; with that switch the browser answers `hover: hover` and
 * `pointer: fine`, which is a four-media-query giveaway that no page script can
 * explain away. Measured in analysis-artifacts/parity-headless.json.
 */
export const PLAYWRIGHT_HEADLESS_POINTER_ARG =
  '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4';

/**
 * Default switches an engine adds that a hand-started Chrome does not have.
 *
 * These cannot be countered after launch: they have to be kept out of the
 * command line through the engine's own `ignoreDefaultArgs` option.
 */
export const ENGINE_PARITY_IGNORED_DEFAULT_ARGS = Object.freeze({
  playwright: Object.freeze({
    always: Object.freeze(['--enable-automation']),
    headless: Object.freeze([PLAYWRIGHT_HEADLESS_POINTER_ARG]),
  }),
  puppeteer: Object.freeze({
    always: Object.freeze(['--enable-automation']),
    headless: Object.freeze([]),
  }),
});

/**
 * Default switches to suppress so the engine's command line matches a
 * hand-started Chrome.
 *
 * @param {'playwright'|'puppeteer'} engine Automation engine in use.
 * @param {object} [options]
 * @param {boolean} [options.headless] Whether the browser runs headless.
 * @returns {string[]} Switches to pass as `ignoreDefaultArgs`.
 */
export function parityIgnoredDefaultArgs(engine, { headless = false } = {}) {
  const entry = ENGINE_PARITY_IGNORED_DEFAULT_ARGS[engine];
  if (!entry) {
    throw new TypeError(
      `unknown engine "${engine}"; expected one of ${Object.keys(
        ENGINE_PARITY_IGNORED_DEFAULT_ARGS
      ).join(', ')}`
    );
  }
  return [...entry.always, ...(headless ? entry.headless : [])];
}
