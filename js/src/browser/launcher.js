import { launchFailure } from './launch-diagnostics.js';
import {
  installSessionPersistence,
  sessionPersistencePath,
} from './session-persistence.js';

import { assertSupportedEngine } from './connector.js';
import { emulateMedia } from './media.js';
import { reserveLoopbackPort } from './debugging-port.js';
import { attachLaunchDebug, debugEnabled } from '../traces/debug-session.js';
import { validateDebugConfig } from '../traces/debug-output.js';
import {
  buildPlaywrightLaunchOptions,
  buildPuppeteerLaunchOptions,
  resolveChromeArgs,
} from './launch-options.js';
import {
  createTemporaryUserDataDir,
  configureUserDataDir,
  removeUserDataDir,
} from './profile-directory.js';
import {
  ENGINE_BROWSERS,
  defaultRestrictionsFor,
  resolveLaunchExecutable,
} from './launch-executable.js';
import { launchRealBrowser } from './real-browser.js';
import { resolveRestrictions } from './restrictions.js';
import { applyFingerprint } from '../fingerprint/apply.js';
import { attachDownloads } from '../downloads/attach.js';
import { launchWebDriver } from './webdriver.js';
import { launchSafari } from './safari-launch.js';
import { isSafariChannel } from './safari-support.js';
import {
  loadStorageState,
  restorePlaywrightStorageState,
  restorePuppeteerStorageState,
  restoreWebDriverStorageState,
} from './storage-state.js';
import { interruptionMode } from '../utilities/subprocess.js';
import {
  FRESH_PROFILE,
  prepareSessionRestore,
  resolveKeepSessionCookies,
  sessionCookieArgs,
  sessionCookieWarning,
  validateSessionCookieOptions,
} from './persistent-profile.js';

export { resolveLaunchExecutable };

/** How `launchBrowser` starts the browser (issue #103). */
export const LAUNCH_MODES = Object.freeze(['real', 'engine']);

function validateLaunchMode({ engine, launch, attach }) {
  assertSupportedEngine(engine);
  if (!LAUNCH_MODES.includes(launch)) {
    throw new Error(
      `Invalid launch mode: ${launch}. Expected 'real' or 'engine'`
    );
  }
  if (attach !== undefined && launch !== 'real') {
    throw new TypeError(
      "attach needs launch: 'real'; an engine launch starts its own profile"
    );
  }
}

async function launchReal(options, dependencies) {
  const {
    engine,
    channel,
    executablePath,
    slowMo,
    verbose,
    storageState,
    ...rest
  } = options;
  const launchRealImplementation =
    dependencies.launchRealBrowser ?? launchRealBrowser;
  const session = await launchRealImplementation({
    ...rest,
    // The channel still names the browser whose profile an attach snapshot
    // copies and a migration targets; the executable is resolved here.
    ...(channel ? { channel } : {}),
    engine,
    verbose,
    storageState,
    executablePath: await resolveLaunchExecutable(
      { engine, channel, executablePath },
      dependencies
    ),
    ...(slowMo ? { slowMo } : {}),
  });
  const {
    browser: connectedBrowser,
    page,
    close,
    downloads: _none,
    ...meta
  } = session;
  // Playwright's persistent-context launch returned a BrowserContext, so the
  // real launch returns the attached default context the same way; closing
  // it closes the browser this call started.
  const browser =
    engine === 'playwright' ? connectedBrowser.contexts()[0] : connectedBrowser;
  if (browser !== connectedBrowser) {
    browser.close = close;
  }
  return { browser, page, close, connectedBrowser, ...meta };
}

// The Chrome for Testing an engine launch starts on its own, or the one a
// Selenium launch is pointed at; undefined for any installed browser.
async function engineExecutable(
  { engine, browser = 'chrome', channel, executablePath },
  engineModule,
  dependencies
) {
  if (executablePath !== undefined || channel !== undefined) {
    return executablePath;
  }
  if (engine === 'selenium') {
    // Without Chrome for Testing this fails rather than let the driver pick
    // the installed Google Chrome (issue #179).
    return browser === 'chrome'
      ? await resolveLaunchExecutable({ engine }, dependencies)
      : undefined;
  }
  return await Promise.resolve()
    .then(() => engineModule.executablePath?.())
    .catch(() => undefined);
}

// Playwright's headless default is chromium-headless-shell, which deletes
// session cookies at startup even with --restore-last-session; the full
// Chromium build in new headless mode keeps them (measured with Playwright's
// chromium-1243, experiments/issue-187/playwright-channel.mjs).
function playwrightSessionChannel({ headless, channel, executablePath }) {
  return headless && channel === undefined && executablePath === undefined
    ? 'chromium'
    : channel;
}

function headlessShellWarnings({ engine, headless, channel, executablePath }) {
  const shell =
    headless === 'shell' ||
    (headless &&
      (channel === 'chromium-headless-shell' ||
        /headless[_-]shell/u.test(String(executablePath ?? ''))));
  return engine !== 'selenium' && shell
    ? [
        sessionCookieWarning(
          'headless-shell',
          'chromium-headless-shell deletes session cookies at startup; use the full Chromium build (channel: "chromium", or headless: true for Puppeteer) to keep them'
        ),
      ]
    : [];
}

async function launchWithEngine(options, dependencies) {
  if (options.engine === 'selenium') {
    // launchWebDriver adds the defaults of the browser it resolves.
    const executablePath = await engineExecutable(options, null, dependencies);
    const launched = await (dependencies.launchWebDriver ?? launchWebDriver)({
      ...options,
      ...(executablePath ? { executablePath } : {}),
      args: [...options.args, ...options.extraArgs],
    });
    return { ...launched, browser: launched.driver };
  }
  const engineModule = await (
    dependencies.loadEngineModule ?? ENGINE_BROWSERS[options.engine]
  )();
  const defaultRestrictions = defaultRestrictionsFor(
    await engineExecutable(options, engineModule, dependencies),
    options.defaultRestrictions
  );
  const restrictions = [...defaultRestrictions, ...options.restrictions];
  const {
    engine,
    userDataDir: requestedUserDataDir,
    headless,
    slowMo,
    args,
    extraArgs,
    ignoreDefaultArgs,
    env,
    colorScheme,
    channel,
    executablePath,
    automationParity,
    storageState,
    interruption,
  } = options;
  // The engines install their own SIGINT handler that closes the browser;
  // with caller-owned interruption the embedder's handler decides (#174).
  const signals =
    interruptionMode(interruption) === 'caller' ? { handleSIGINT: false } : {};
  const temporaryProfile = !requestedUserDataDir;
  // A persistent profile keeps session cookies across restarts (issue #187).
  const keepSessionCookies = resolveKeepSessionCookies({
    keepSessionCookies: options.keepSessionCookies,
    temporaryProfile,
  });
  const chrome = resolveChromeArgs({
    args: [
      ...sessionCookieArgs(keepSessionCookies).filter(
        (argument) => !args.includes(argument) && !extraArgs.includes(argument)
      ),
      ...args,
    ],
    extraArgs,
    ignoreDefaultArgs,
    restrictions,
    disableFeatures: options.disableFeatures,
  });
  const restrictionEnv = resolveRestrictions(restrictions).env;
  const childEnv =
    env || Object.keys(restrictionEnv).length > 0
      ? { ...process.env, ...restrictionEnv, ...env }
      : undefined;
  const userDataDir =
    requestedUserDataDir ?? (await createTemporaryUserDataDir());
  await configureUserDataDir(userDataDir, {
    preferences: {
      ...resolveRestrictions(restrictions).preferences,
      ...options.preferences,
    },
    localState: options.localState,
  });
  await prepareSessionRestore(userDataDir, {
    keepSessionCookies,
    restoreTabs: options.restoreTabs,
    args: chrome.args,
  });
  const selection = {
    channel:
      engine === 'playwright' && keepSessionCookies === true
        ? playwrightSessionChannel({ headless, channel, executablePath })
        : channel,
    executablePath,
  };

  let browser;
  let page;
  try {
    if (engine === 'playwright') {
      browser = await engineModule.launchPersistentContext(userDataDir, {
        ...buildPlaywrightLaunchOptions({
          headless,
          slowMo,
          chromeArgs: chrome.args,
          colorScheme,
          ...selection,
          ignoreDefaultArgs: chrome.ignoreDefaultArgs,
          automationParity,
        }),
        ...signals,
        ...(childEnv ? { env: childEnv } : {}),
      });
      page = browser.pages()[0] ?? (await browser.newPage());
      await restorePlaywrightStorageState({ context: browser, storageState });
    } else {
      browser = await engineModule.launch({
        ...buildPuppeteerLaunchOptions({
          headless,
          chromeArgs: chrome.args,
          userDataDir,
          ...selection,
          ignoreDefaultArgs: chrome.ignoreDefaultArgs,
          automationParity,
        }),
        ...(slowMo ? { slowMo } : {}),
        ...signals,
        ...(childEnv ? { env: childEnv } : {}),
      });
      page = (await browser.pages())[0] ?? (await browser.newPage());
      await restorePuppeteerStorageState({ page, storageState });
    }
  } catch (error) {
    await browser?.close().catch(() => {});
    if (temporaryProfile) {
      await removeUserDataDir(userDataDir);
    }
    throw error;
  }

  const originalClose = browser.close.bind(browser);
  let closing;
  const close = () => {
    closing ??= (async () => {
      await originalClose().catch(() => {});
      if (temporaryProfile) {
        await removeUserDataDir(userDataDir);
      }
    })();
    return closing;
  };
  browser.close = close;
  return {
    browser,
    page,
    close,
    userDataDir,
    temporaryProfile,
    keepSessionCookies: keepSessionCookies === true,
    warnings:
      keepSessionCookies === true
        ? headlessShellWarnings({ engine, headless, ...selection })
        : [],
    args: chrome.args,
    defaultRestrictions,
  };
}

async function unfocusAddressBar(page, verbose, settleMs = 500) {
  // Bringing the page to front moves focus from the address bar to the page.
  try {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    await page.bringToFront();
    if (verbose) {
      console.log('✅ Address bar unfocused automatically');
    }
  } catch (error) {
    // Ignore errors - this is just a UX improvement
    if (verbose) {
      console.log('⚠️  Could not unfocus address bar:', error.message);
    }
  }
}

/**
 * Launch a browser.
 *
 * By default (`launch: 'real'`) Browser Commander starts Chrome itself,
 * exactly like a person who wants to attach a debugger would:
 * `--user-data-dir=<fresh temporary profile> --remote-debugging-port=<reserved
 * port>` and nothing else, then attaches the engine over CDP (issues #101 and
 * #103). The profile is deleted on close. Every restriction the library used
 * to add silently is an explicit opt-in through `restrictions`.
 *
 * The browser is the engine's Chrome for Testing, an application of its own,
 * so the user's Google Chrome is never taken over; `channel: 'chrome'` asks
 * for the installed Google Chrome. Chrome for Testing gets the
 * `chrome-for-testing` restrictions (`--test-type=gpu`, the only switch that
 * hides its "only for automated testing" bar, and `--use-mock-keychain`)
 * unless `defaultRestrictions` says otherwise (issue #179).
 *
 * `launch: 'engine'` keeps the Playwright/Puppeteer-launched browser for CI
 * and headless use; the switches those engines add are listed in
 * limitations.json (`engine-launch-switches`).
 *
 * @param {Object} options - Configuration options
 * @param {string} [options.engine='playwright'] - Browser automation engine: 'playwright', 'puppeteer' or 'selenium'
 * @param {'real'|'engine'} [options.launch='real'] - Who starts the browser: Browser Commander (a hand-started command line) or the automation engine
 * @param {string} [options.userDataDir] - Persistent profile directory. When omitted a fresh temporary profile is created and deleted on close.
 * @param {boolean} [options.keepSessionCookies] - Keep session cookies across restarts: the default with userDataDir; a temporary profile is left as it is. false lets the browser delete them at startup (issue #187)
 * @param {boolean} [options.restoreTabs=false] - With keepSessionCookies, also reopen the last session's tabs instead of starting with one tab
 * @param {boolean} [options.headless=false] - Run in headless mode
 * @param {number} [options.slowMo=0] - Slow down operations by ms
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {string[]} [options.restrictions] - Opt-in restrictions from launch-restrictions.json, such as 'no-extensions' or the 'legacy-defaults' preset
 * @param {string[]} [options.defaultRestrictions] - Restrictions that replace the executable's defaults (the 'chrome-for-testing' preset for Chrome for Testing, none otherwise); [] turns them off
 * @param {string[]} [options.args] - Additional Chrome arguments
 * @param {string[]} [options.extraArgs] - Additional Chrome arguments appended after args
 * @param {boolean|string[]} [options.ignoreDefaultArgs] - Engine default switches to omit, or true for all ('engine' launch only)
 * @param {Object<string,string>} [options.env] - Extra environment for the browser process only
 * @param {string|null} [options.colorScheme] - Emulate color scheme: 'light', 'dark', 'no-preference', or null to reset
 * @param {string} [options.channel] - Installed browser channel, such as 'chrome', 'chrome-beta', 'msedge', 'brave' or 'chromium'; without it (and without executablePath) the engine's Chrome for Testing is started
 * @param {string} [options.executablePath] - Explicit path to a Chrome or Chromium executable
 * @param {number} [options.remoteDebuggingPort] - Fixed CDP port for the real launch; a free one is reserved when omitted
 * @param {string|Object} [options.storageState] - Playwright-compatible storage state path or object
 * @param {Object} [options.fingerprint] - Environment fields to present to pages, such as userAgent, timezone, locale, hardwareConcurrency or screen. Applied over CDP after launch; see src/fingerprint/profile.js for the full field list and presets.js for ready-made profiles.
 * @param {boolean} [options.automationParity=true] - Keep navigator.webdriver false where a launch switch would turn it on (headless or engine launches)
 * @param {boolean|Object} [options.downloads] - Manage downloads: true for defaults, or {directory, persist, conflict}. The directory may be an absolute path, 'user-downloads' or 'temporary'.
 * @param {boolean|Object} [options.debug=false] - Opt-in recording: true, {output}, or {directory, retain, maxDurationMs, limits} for managed storage
 * @returns {Promise<{browser: Object, page: Object, downloads: (Object|null), close: function(): Promise<void>, launch: string, userDataDir: string, temporaryProfile: boolean, keepSessionCookies: boolean, warnings: Array<{item: string, reason: string, detail: string}>, args: Array<string>, defaultRestrictions: Array<string>}>} Browser (a BrowserContext for Playwright), page, download manager and launch metadata
 */
export async function launchBrowser(options = {}) {
  return await launchBrowserWithDependencies(options);
}

/** Dependency-injected implementation used by {@link launchBrowser} and tests. */
export async function launchBrowserWithDependencies(
  options = {},
  dependencies = {}
) {
  if (debugEnabled(options) && typeof options.debug === 'object') {
    validateDebugConfig(options.debug);
  }
  if (options.keepOpen) {
    const connectOrLaunch =
      dependencies.connectOrLaunch ??
      (await import('./persistent-session.js')).connectOrLaunch;
    return attachLaunchDebug(
      await connectOrLaunch({
        ...options,
        userDataDir:
          options.userDataDir ?? (await createTemporaryUserDataDir()),
        // A profile created here starts empty, like a temporary one.
        [FRESH_PROFILE]: options.userDataDir === undefined,
        remoteDebuggingPort:
          options.remoteDebuggingPort ?? (await reserveLoopbackPort()),
      }),
      options
    );
  }
  sessionPersistencePath(options);
  if (isSafariChannel(options.channel ?? options.browser)) {
    validateLaunchMode({
      engine: options.engine ?? 'playwright',
      launch: options.launch ?? 'real',
      attach: options.attach,
    });
    return attachLaunchDebug(
      await launchSafari(options, dependencies),
      options
    );
  }
  const result = await launchNonSafariBrowser(options, dependencies);
  try {
    return await attachLaunchDebug(
      await installSessionPersistence(result, options),
      options
    );
  } catch (error) {
    await result.close();
    throw error;
  }
}

function validateSeleniumLaunch({
  launch,
  browser,
  colorScheme,
  fingerprint,
  downloads,
}) {
  if (colorScheme !== undefined || fingerprint !== undefined || downloads) {
    throw new Error(
      'selenium does not support CDP emulation, fingerprint overrides or managed downloads (webdriver-no-cdp-emulation)'
    );
  }
  if (launch === 'real' && browser === 'firefox') {
    throw new Error("selenium Firefox requires launch: 'engine'");
  }
}

async function launchNonSafariBrowser(options, dependencies) {
  const {
    engine = 'playwright',
    launch = 'real',
    headless = false,
    slowMo = 0,
    verbose = false,
    args = [],
    extraArgs = [],
    ignoreDefaultArgs = [],
    restrictions = [],
    colorScheme,
    storageState,
    fingerprint,
    automationParity = true,
    downloads,
    ...rest
  } = options;
  validateLaunchMode({ engine, launch, attach: rest.attach });
  validateSessionCookieOptions(options);
  if (engine === 'selenium') {
    validateSeleniumLaunch({
      launch,
      colorScheme,
      fingerprint,
      downloads,
      ...rest,
    });
  }
  // Validate arguments before anything is started or written to disk.
  resolveRestrictions(rest.defaultRestrictions ?? []);
  resolveChromeArgs({
    args,
    extraArgs,
    ignoreDefaultArgs,
    restrictions,
    disableFeatures: options.disableFeatures,
  });
  const resolvedStorageState = await loadStorageState(storageState);

  if (verbose) {
    console.log(`🚀 Launching browser with ${engine} engine (${launch})...`);
  }
  const common = {
    ...rest,
    engine,
    headless,
    slowMo,
    verbose,
    args,
    extraArgs,
    restrictions,
    automationParity,
    storageState: resolvedStorageState,
  };
  let launched;
  try {
    launched =
      launch === 'engine'
        ? await launchWithEngine(
            { ...common, ignoreDefaultArgs, colorScheme },
            dependencies
          )
        : await launchReal(common, dependencies);
  } catch (error) {
    throw launchFailure(error, {
      ...common,
      phase: launch === 'engine' ? 'engine_launch' : 'launch',
    });
  }
  const { browser, page } = launched;
  if (verbose) {
    console.log(`✅ Browser launched with ${engine} engine`);
  }

  try {
    if (engine === 'selenium' && launch === 'engine') {
      await restoreWebDriverStorageState({
        page,
        storageState: resolvedStorageState,
      });
    }
    // A Playwright-launched context applies colorScheme itself; an attached
    // browser and Puppeteer need page-level emulation.
    const emulateColorScheme =
      colorScheme !== undefined &&
      (launch === 'real' || engine === 'puppeteer');
    if (emulateColorScheme) {
      await emulateMedia({ page, engine, colorScheme }).catch((error) => {
        if (verbose) {
          console.log(`⚠️  Could not set color scheme: ${error.message}`);
        }
      });
    }

    // The fingerprint is applied before the caller can navigate, so the first
    // document a page loads already sees the configured environment.
    if (fingerprint !== undefined) {
      await applyFingerprint({ browser, page, engine, profile: fingerprint });
      if (verbose) {
        console.log('✅ Fingerprint profile applied');
      }
    }

    await unfocusAddressBar(page, verbose, dependencies.settleMs);

    // Downloads are armed before the caller can navigate: a download triggered
    // by the first page load still lands in the managed directory.
    const downloadManager = await attachDownloads({
      engine,
      browser,
      page,
      downloads,
    });
    return { ...launched, launch, downloads: downloadManager };
  } catch (error) {
    await launched.close();
    throw error;
  }
}
