import { CHROME_ARGS } from '../core/constants.js';
import {
  applyAutomationParityArgs,
  parityIgnoredDefaultArgs,
} from '../fingerprint/automation-parity.js';

function stringArray(value, name) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${name} must be an array of strings`);
  }
  return value;
}

/** Resolve Browser Commander defaults, compatibility args, and extra args. */
export function resolveChromeArgs({
  args = [],
  extraArgs = [],
  ignoreDefaultArgs = [],
} = {}) {
  stringArray(args, 'args');
  stringArray(extraArgs, 'extraArgs');
  if (
    typeof ignoreDefaultArgs !== 'boolean' &&
    !Array.isArray(ignoreDefaultArgs)
  ) {
    throw new TypeError('ignoreDefaultArgs must be a boolean or string array');
  }
  if (Array.isArray(ignoreDefaultArgs)) {
    stringArray(ignoreDefaultArgs, 'ignoreDefaultArgs');
  }

  const normalizedIgnoreDefaultArgs =
    ignoreDefaultArgs === false ? [] : ignoreDefaultArgs;
  const ignored = new Set(
    normalizedIgnoreDefaultArgs === true
      ? CHROME_ARGS
      : normalizedIgnoreDefaultArgs
  );
  return {
    args: [
      ...CHROME_ARGS.filter((argument) => !ignored.has(argument)),
      ...args,
      ...extraArgs,
    ],
    ignoreDefaultArgs: normalizedIgnoreDefaultArgs,
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
  const normalizedIgnoreDefaultArgs =
    ignoreDefaultArgs === false ? [] : ignoreDefaultArgs;
  const engineIgnoreDefaultArgs =
    normalizedIgnoreDefaultArgs === true
      ? true
      : [
          ...new Set([
            '--enable-automation',
            ...(automationParity
              ? parityIgnoredDefaultArgs('playwright', { headless })
              : []),
            ...normalizedIgnoreDefaultArgs,
          ]),
        ];
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
  const normalizedIgnoreDefaultArgs =
    ignoreDefaultArgs === false ? [] : ignoreDefaultArgs;
  const baseArgs = ['--start-maximized', ...chromeArgs];
  const engineIgnoreDefaultArgs =
    normalizedIgnoreDefaultArgs === true
      ? true
      : [
          ...new Set([
            ...(automationParity
              ? parityIgnoredDefaultArgs('puppeteer', { headless })
              : []),
            ...normalizedIgnoreDefaultArgs,
          ]),
        ];
  const options = {
    headless,
    defaultViewport: null,
    args: automationParity ? applyAutomationParityArgs(baseArgs) : baseArgs,
    userDataDir,
  };
  if (engineIgnoreDefaultArgs === true || engineIgnoreDefaultArgs.length > 0) {
    options.ignoreDefaultArgs = engineIgnoreDefaultArgs;
  }
  return setBrowserSelectionOptions(options, { channel, executablePath });
}
