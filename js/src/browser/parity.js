/**
 * Measure how far a browser Browser Commander drives is from the same browser
 * started by hand (issue #103).
 *
 * Three things are compared, because each can give automation away on its
 * own:
 * - the command line, as the browser itself reports it on chrome://version,
 *   against the one a person would type (`--user-data-dir` and, headless,
 *   `--headless=new`);
 * - the feature state the command line sets (`--enable-features`,
 *   `--disable-features`, `--disable-blink-features`, ...);
 * - everything a page can read, through the environment probe that also backs
 *   the parity e2e suite.
 *
 * Every difference is either explained by an entry in the shared limitations
 * catalogue, explained by an option the caller asked for, or unlisted. A
 * report with unlisted differences is not `ok`; `browser-commander doctor`
 * exits non-zero on it and CI fails.
 */
import { randomUUID } from 'node:crypto';

import {
  captureReferenceReport,
  diffReports,
  readProbeSource,
  startProbeServer,
} from '../parity/harness.js';
import { readReferenceVersionPage } from '../parity/version-page.js';
import { findFingerprintLimitation } from '../fingerprint/limitations.js';

/**
 * Switches whose value is different on every launch by construction. Their
 * presence is compared; their value is not.
 */
const VOLATILE_SWITCHES = new Set(['--user-data-dir']);

/**
 * Markers Chrome itself writes around the switches it took from chrome://flags.
 * A hand-started browser shows them too.
 */
const CHROME_MARKERS = new Set([
  '--flag-switches-begin',
  '--flag-switches-end',
]);

/** Switches that carry a comma-separated feature list. */
const FEATURE_SWITCHES = new Set([
  '--enable-features',
  '--disable-features',
  '--enable-blink-features',
  '--disable-blink-features',
]);

/**
 * The debugging port is how the library attaches. Issue #101 measured that a
 * fixed non-zero port changes nothing a page can observe, so it is reported
 * as the attachment rather than as a difference.
 */
const ATTACHMENT_SWITCHES = new Set(['--remote-debugging-port']);

/**
 * Split a command line into `--switch[=value]` entries.
 *
 * chrome://version prints the command line joined with spaces, so a value
 * containing a space (a profile path, say) cannot be recovered exactly. Every
 * `--` that follows whitespace starts a new switch; the executable and any
 * trailing URL are not switches and are dropped.
 *
 * @param {string|string[]} commandLine
 * @returns {Map<string, string|null>} switch name to value (`null` for a flag)
 */
export function parseSwitches(commandLine) {
  const tokens = Array.isArray(commandLine)
    ? commandLine
    : String(commandLine)
        .trim()
        // The start URL, when there is one, is the last word.
        .replace(/\s+[a-z][a-z0-9+.-]*:\S*$/iu, '')
        .split(/\s+(?=--)/u);
  const switches = new Map();
  for (const token of tokens) {
    if (!token.startsWith('--')) {
      continue;
    }
    const separator = token.indexOf('=');
    if (separator === -1) {
      switches.set(token, null);
    } else {
      switches.set(token.slice(0, separator), token.slice(separator + 1));
    }
  }
  return switches;
}

function featureList(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
}

/**
 * Compare the command line the browser reports with the reference one.
 *
 * @param {string[]} reference - Arguments the hand-started browser received
 * @param {string|string[]} candidate - chrome://version command line
 * @returns {{extra: string[], missing: string[], changed: Object[], attachment: string[], features: Object}}
 */
export function compareCommandLines(reference, candidate) {
  const left = parseSwitches(reference);
  const right = parseSwitches(candidate);
  const extra = [];
  const missing = [];
  const changed = [];
  const attachment = [];
  const features = {};
  const names = new Set([...left.keys(), ...right.keys()]);
  for (const name of [...names].sort()) {
    if (CHROME_MARKERS.has(name)) {
      continue;
    }
    if (ATTACHMENT_SWITCHES.has(name)) {
      if (right.has(name)) {
        attachment.push(`${name}=${right.get(name)}`);
      }
      continue;
    }
    const format = (map) =>
      map.get(name) === null ? name : `${name}=${map.get(name)}`;
    if (!left.has(name)) {
      extra.push(format(right));
    } else if (!right.has(name)) {
      missing.push(format(left));
    } else if (
      !VOLATILE_SWITCHES.has(name) &&
      left.get(name) !== right.get(name)
    ) {
      changed.push({
        name,
        reference: left.get(name),
        candidate: right.get(name),
      });
    }
    if (FEATURE_SWITCHES.has(name)) {
      features[name] = {
        reference: featureList(left.get(name)),
        candidate: featureList(right.get(name)),
      };
    }
  }
  return { extra, missing, changed, attachment, features };
}

function commandLineDifferences(comparison) {
  return [
    ...comparison.extra.map((entry) => ({
      path: `commandLine.extra.${entry.split('=')[0]}`,
      reference: null,
      candidate: entry,
    })),
    ...comparison.missing.map((entry) => ({
      path: `commandLine.missing.${entry.split('=')[0]}`,
      reference: entry,
      candidate: null,
    })),
    ...comparison.changed.map(({ name, reference, candidate }) => ({
      path: `commandLine.changed.${name}`,
      reference,
      candidate,
    })),
  ];
}

/**
 * Explain a difference: a limitation id, `requested` for a switch the caller
 * asked for (or that follows from an option they set), or `null`.
 */
export function explainDifference(difference, context) {
  const { path } = difference;
  if (path.startsWith('commandLine.')) {
    const value = String(difference.candidate ?? difference.reference ?? '');
    if (context.requestedArgs.some((arg) => arg === value)) {
      return { requested: true };
    }
    if (context.launch === 'engine') {
      return { limitation: 'engine-launch-switches' };
    }
    return {};
  }
  if (path.startsWith('navigator.userAgentData.brands')) {
    return { limitation: 'grease-brand-not-reproduced' };
  }
  if (path === 'navigator.webdriver' && context.attached) {
    return { limitation: 'automation-controlled-is-launch-only' };
  }
  return {};
}

/**
 * Tag every difference with its explanation and split out the unlisted ones.
 *
 * @param {Object[]} differences - `{path, reference, candidate}` entries
 * @param {Object} context
 * @returns {{differences: Object[], unlisted: Object[]}}
 */
export function classifyDifferences(differences, context) {
  const tagged = differences.map((difference) => {
    const explanation = explainDifference(difference, context);
    const limitation =
      explanation.limitation &&
      findFingerprintLimitation(explanation.limitation)
        ? explanation.limitation
        : null;
    return {
      path: difference.path,
      expected: difference.reference ?? null,
      actual: difference.candidate ?? null,
      limitation,
      requested: explanation.requested === true,
    };
  });
  return {
    differences: tagged,
    unlisted: tagged.filter((entry) => !entry.limitation && !entry.requested),
  };
}

/**
 * Read the browser's own view of itself from chrome://version in a new tab,
 * so the page under measurement is left where it was.
 *
 * @param {Object} page - A Playwright or Puppeteer page of the browser
 * @returns {Promise<{commandLine: string, version: string, executablePath: string}>}
 */
export async function readBrowserVersionPage(page) {
  const opener =
    typeof page.context === 'function' ? page.context() : page.browser();
  const versionPage = await opener.newPage();
  try {
    await versionPage.goto('chrome://version');
    return await versionPage.evaluate(() => {
      const text = (id) =>
        (document.getElementById(id)?.textContent ?? '').trim();
      return {
        commandLine: text('command_line'),
        version: text('version'),
        executablePath: text('executable_path'),
      };
    });
  } finally {
    await versionPage.close().catch(() => {});
  }
}

async function captureCandidate(session, server, readVersionPage) {
  const token = randomUUID();
  await session.page.goto(server.url(token), { waitUntil: 'load' });
  const report = await server.waitForReport(token);
  const versionPage = await readVersionPage(session.page);
  return { report, versionPage };
}

function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function requestedArgsFor(session, options) {
  const requested = [...(options.args ?? []), ...(options.extraArgs ?? [])];
  const launchedArgs = session.args ?? [];
  if ((options.restrictions ?? []).length > 0) {
    requested.push(
      ...launchedArgs.filter(
        (arg) =>
          !arg.startsWith('--user-data-dir') &&
          !arg.startsWith('--remote-debugging-port')
      )
    );
  }
  return requested;
}

/**
 * Measure a launched (or about-to-be-launched) browser against the same
 * binary started by hand.
 *
 * @param {Object} [options] - Launch options for {@link launchBrowser} (engine,
 *   channel, executablePath, headless, launch, restrictions, args, ...)
 * @param {Object} [options.session] - Measure this already-launched session
 *   (the result of `launchBrowser`/`launchRealBrowser`) instead of launching
 * @param {boolean} [options.attached=false] - The session was started by
 *   somebody else and only connected to
 * @param {Object} [dependencies] - Test seams
 * @returns {Promise<Object>} The parity report described in docs/cli-and-bridge.md
 */
export async function measureParity(options = {}, dependencies = {}) {
  const {
    session: providedSession,
    attached = false,
    headless = false,
    ...launchOptions
  } = options;
  const {
    launchBrowser = (await import('./launcher.js')).launchBrowser,
    resolveLaunchExecutable = (await import('./launcher.js'))
      .resolveLaunchExecutable,
    startServer = startProbeServer,
    readProbe = readProbeSource,
    captureReference = captureReferenceReport,
    readVersionPage = readBrowserVersionPage,
    readReferenceVersion = readReferenceVersionPage,
  } = dependencies;

  const engine = launchOptions.engine ?? 'playwright';
  const executablePath =
    providedSession?.executablePath ??
    (await resolveLaunchExecutable({
      engine,
      channel: launchOptions.channel,
      executablePath: launchOptions.executablePath,
    }));
  const server = await startServer(await readProbe());
  try {
    const reference = await captureReference({
      executablePath,
      server,
      token: randomUUID(),
      headless,
    });
    // The browser appends switches of its own (`--ozone-platform=...`, and
    // several more headless), so the reference command line is what the same
    // binary reports for the argv a person types, not that argv.
    const referenceVersionPage = await readReferenceVersion({
      executablePath,
      headless,
    });
    const session =
      providedSession ??
      (await launchBrowser({
        ...launchOptions,
        engine,
        executablePath,
        headless,
      }));
    let candidate;
    try {
      candidate = await captureCandidate(session, server, readVersionPage);
    } finally {
      if (!providedSession) {
        await session.browser.close();
      }
    }
    const launch = session.launch ?? launchOptions.launch ?? 'real';
    const commandLine = compareCommandLines(
      referenceVersionPage.commandLine,
      candidate.versionPage.commandLine
    );
    const { differences, unlisted } = classifyDifferences(
      [
        ...commandLineDifferences(commandLine),
        ...diffReports(reference, candidate.report),
      ],
      {
        launch,
        attached,
        requestedArgs: requestedArgsFor(session, { ...options, headless }),
      }
    );
    return {
      browser: {
        executablePath,
        version: normalizeWhitespace(candidate.versionPage.version),
        engine,
        launch,
        headless,
      },
      commandLine: {
        launched: candidate.versionPage.commandLine,
        reference: referenceVersionPage.commandLine,
        ...commandLine,
      },
      differences,
      unlisted,
      ok: unlisted.length === 0,
    };
  } finally {
    await server.close();
  }
}
