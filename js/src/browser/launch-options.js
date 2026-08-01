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
}) {
  const options = {
    headless,
    slowMo,
    chromiumSandbox: true,
    viewport: null,
    args: chromeArgs,
    ignoreDefaultArgs: ['--enable-automation'],
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
}) {
  return setBrowserSelectionOptions(
    {
      headless,
      defaultViewport: null,
      args: ['--start-maximized', ...chromeArgs],
      userDataDir,
    },
    { channel, executablePath }
  );
}
