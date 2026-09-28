import {
  assertStringArray,
  mergeFeatureSwitches,
  resolveRestrictions,
} from './restrictions.js';
import {
  applyAutomationParityArgs,
  parityIgnoredDefaultArgs,
} from '../fingerprint/automation-parity.js';

/**
 * Resolve the switches an engine-launched browser gets on top of the engine's
 * own: opt-in restrictions, then custom args (issue #103). Browser Commander
 * adds nothing by default; `CHROME_ARGS` is kept only as the
 * `legacy-defaults` restriction preset.
 *
 * @param {Object} [options]
 * @param {string[]} [options.args]
 * @param {string[]} [options.extraArgs]
 * @param {boolean|string[]} [options.ignoreDefaultArgs] - Engine defaults to omit
 * @param {string[]} [options.restrictions] - Names from launch-restrictions.json
 * @returns {{args: string[], ignoreDefaultArgs: boolean|string[]}}
 */
export function resolveChromeArgs({
  args = [],
  extraArgs = [],
  ignoreDefaultArgs = [],
  restrictions = [],
} = {}) {
  assertStringArray(args, 'args');
  assertStringArray(extraArgs, 'extraArgs');
  if (
    typeof ignoreDefaultArgs !== 'boolean' &&
    !Array.isArray(ignoreDefaultArgs)
  ) {
    throw new TypeError('ignoreDefaultArgs must be a boolean or string array');
  }
  if (Array.isArray(ignoreDefaultArgs)) {
    assertStringArray(ignoreDefaultArgs, 'ignoreDefaultArgs');
  }

  return {
    args: mergeFeatureSwitches([
      ...resolveRestrictions(restrictions).args,
      ...args,
      ...extraArgs,
    ]),
    ignoreDefaultArgs: ignoreDefaultArgs === false ? [] : ignoreDefaultArgs,
  };
}

function setBrowserSelectionOptions(options, { channel, executablePath }) {
  if (channel !== undefined) {
    options.channel = channel;
  }
  if (executablePath !== undefined) {
    options.executablePath = executablePath;
  }
  return options;
}

/**
 * The engine default switches to drop: the caller's list plus, with
 * automation parity, the ones that turn AutomationControlled on.
 *
 * @param {'playwright'|'puppeteer'} engine
 * @returns {true|string[]}
 */
function resolveEngineIgnoreDefaultArgs(
  engine,
  { headless, ignoreDefaultArgs, automationParity, always = [] }
) {
  if (ignoreDefaultArgs === true) {
    return true;
  }
  return [
    ...new Set([
      ...always,
      ...(automationParity
        ? parityIgnoredDefaultArgs(engine, { headless })
        : []),
      ...(ignoreDefaultArgs === false ? [] : ignoreDefaultArgs),
    ]),
  ];
}

export function buildPlaywrightLaunchOptions({
  headless,
  slowMo,
  chromeArgs,
  colorScheme,
  channel,
  executablePath,
  ignoreDefaultArgs = [],
  automationParity = true,
}) {
  const engineIgnoreDefaultArgs = resolveEngineIgnoreDefaultArgs('playwright', {
    headless,
    ignoreDefaultArgs,
    automationParity,
    always: ['--enable-automation'],
  });
  const options = {
    headless,
    slowMo,
    chromiumSandbox: true,
    viewport: null,
    args: automationParity ? applyAutomationParityArgs(chromeArgs) : chromeArgs,
    ignoreDefaultArgs: engineIgnoreDefaultArgs,
  };

  if (colorScheme !== undefined) {
    options.colorScheme = colorScheme;
  }

  return setBrowserSelectionOptions(options, { channel, executablePath });
}

export function buildPuppeteerLaunchOptions({
  headless,
  chromeArgs,
  userDataDir,
  channel,
  executablePath,
  ignoreDefaultArgs = [],
  automationParity = true,
}) {
  const engineIgnoreDefaultArgs = resolveEngineIgnoreDefaultArgs('puppeteer', {
    headless,
    ignoreDefaultArgs,
    automationParity,
  });
  const options = {
    headless,
    defaultViewport: null,
    args: automationParity ? applyAutomationParityArgs(chromeArgs) : chromeArgs,
    userDataDir,
  };
  if (engineIgnoreDefaultArgs === true || engineIgnoreDefaultArgs.length > 0) {
    options.ignoreDefaultArgs = engineIgnoreDefaultArgs;
  }
  return setBrowserSelectionOptions(options, { channel, executablePath });
}
