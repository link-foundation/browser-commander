import { CHROME_ARGS } from '../core/constants.js';

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
}) {
  const normalizedIgnoreDefaultArgs =
    ignoreDefaultArgs === false ? [] : ignoreDefaultArgs;
  const engineIgnoreDefaultArgs =
    normalizedIgnoreDefaultArgs === true
      ? true
      : [...new Set(['--enable-automation', ...normalizedIgnoreDefaultArgs])];
  const options = {
    headless,
    slowMo,
    chromiumSandbox: true,
    viewport: null,
    args: chromeArgs,
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
}) {
  const normalizedIgnoreDefaultArgs =
    ignoreDefaultArgs === false ? [] : ignoreDefaultArgs;
  const options = {
    headless,
    defaultViewport: null,
    args: ['--start-maximized', ...chromeArgs],
    userDataDir,
  };
  if (
    normalizedIgnoreDefaultArgs === true ||
    normalizedIgnoreDefaultArgs.length > 0
  ) {
    options.ignoreDefaultArgs = normalizedIgnoreDefaultArgs;
  }
  return setBrowserSelectionOptions(options, { channel, executablePath });
}
