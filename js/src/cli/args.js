/**
 * Command-line parsing for `browser-commander` (docs/cli-and-bridge.md,
 * "Commands"). Built on `node:util` `parseArgs`; option names are kebab-case
 * on the command line and camelCase in the parsed result.
 */
import { parseArgs } from 'node:util';

/** A malformed command line. The CLI prints it as JSON and exits 64. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const STRING = { type: 'string' };
const STRINGS = { type: 'string', multiple: true };
const FLAG = { type: 'boolean' };

/** Options that choose and start a browser. */
const BROWSER_OPTIONS = Object.freeze({
  engine: STRING,
  browser: STRING,
  'executable-path': STRING,
  'user-data-dir': STRING,
  headless: FLAG,
  launch: STRING,
  restriction: STRINGS,
  arg: STRINGS,
  pref: STRINGS,
  'local-state': STRINGS,
  'default-browser-check': FLAG,
  'first-run': FLAG,
  'driver-path': STRING,
  bidi: FLAG,
});

/** Options accepted by every page command. */
const PAGE_OPTIONS = Object.freeze({
  ...BROWSER_OPTIONS,
  'cdp-endpoint': STRING,
  'server-url': STRING,
  url: STRING,
});

/**
 * Every command: its positional argument names and its options.
 * Two-word commands (`trace start`) are keyed by both words.
 */
export const COMMANDS = Object.freeze({
  version: { positionals: [], options: {} },
  launch: {
    positionals: [],
    options: {
      ...BROWSER_OPTIONS,
      'keep-open': FLAG,
      attach: STRING,
      from: STRING,
      profile: STRING,
    },
  },
  open: { positionals: ['url'], options: {} },
  goto: { positionals: ['url'], options: PAGE_OPTIONS },
  click: { positionals: ['selector'], options: PAGE_OPTIONS },
  fill: { positionals: ['selector', 'value'], options: PAGE_OPTIONS },
  eval: { positionals: ['expression'], options: PAGE_OPTIONS },
  screenshot: {
    positionals: ['path'],
    options: { ...PAGE_OPTIONS, 'full-page': FLAG },
  },
  pdf: { positionals: ['path'], options: PAGE_OPTIONS },
  'trace start': { positionals: [], options: { ...PAGE_OPTIONS, out: STRING } },
  'trace stop': { positionals: [], options: { out: STRING } },
  'trace view': { positionals: ['dir'], options: { out: STRING } },
  'cookies import': {
    positionals: [],
    options: {
      ...PAGE_OPTIONS,
      from: STRING,
      profile: STRING,
      domain: STRINGS,
    },
  },
  'cookies sources': {
    positionals: [],
    options: { domain: STRINGS },
  },
  'profile migrate': {
    positionals: [],
    options: {
      from: STRING,
      profile: STRING,
      'user-data-dir': STRING,
      'target-browser': STRING,
      'password-csv': STRING,
      'include-payment-cards': FLAG,
      to: STRING,
      include: STRING,
      domain: STRINGS,
    },
  },
  'profile snapshot': {
    positionals: [],
    options: { from: STRING, profile: STRING, to: STRING },
  },
  'profile sources': {
    positionals: [],
    options: { browser: STRING },
  },
  attach: {
    positionals: [],
    options: { mode: STRING, port: STRING, timeout: STRING },
  },
  doctor: { positionals: [], options: BROWSER_OPTIONS },
  run: { positionals: ['script'], options: BROWSER_OPTIONS },
  serve: { positionals: [], options: { stdio: FLAG } },
});

const GROUPS = new Set(
  Object.keys(COMMANDS)
    .filter((name) => name.includes(' '))
    .map((name) => name.split(' ')[0])
);

/** `executable-path` → `executablePath`. */
export function camelCase(name) {
  return name.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
}

function resolveCommand(argv) {
  const [first, second] = argv;
  if (first === undefined || first.startsWith('-')) {
    throw new UsageError(
      `Missing command; expected one of: ${Object.keys(COMMANDS).join(', ')}`
    );
  }
  if (GROUPS.has(first)) {
    const name = `${first} ${second}`;
    if (!Object.hasOwn(COMMANDS, name)) {
      const choices = Object.keys(COMMANDS)
        .filter((command) => command.startsWith(`${first} `))
        .join(', ');
      throw new UsageError(`Unknown command "${name}"; expected ${choices}`);
    }
    return { name, rest: argv.slice(2) };
  }
  if (!Object.hasOwn(COMMANDS, first)) {
    throw new UsageError(`Unknown command "${first}"`);
  }
  return { name: first, rest: argv.slice(1) };
}

/**
 * Parse a command line.
 *
 * @param {string[]} argv - Arguments after the program name
 * @returns {{command: string, args: Object<string,string>, options: Object}}
 * @throws {UsageError}
 */
export function parseCommandLine(argv) {
  const { name, rest } = resolveCommand(argv);
  const spec = COMMANDS[name];
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: spec.options,
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    throw new UsageError(`${name}: ${error.message}`);
  }
  if (parsed.positionals.length !== spec.positionals.length) {
    const expected = spec.positionals.map((item) => `<${item}>`).join(' ');
    throw new UsageError(
      `Usage: browser-commander ${name}${expected ? ` ${expected}` : ''}`
    );
  }
  const args = Object.fromEntries(
    spec.positionals.map((item, index) => [item, parsed.positionals[index]])
  );
  const options = Object.fromEntries(
    Object.entries(parsed.values).map(([key, value]) => [camelCase(key), value])
  );
  return { command: name, args, options };
}

/** Throw a usage error unless an option was given. */
export function requireOption(options, name, command) {
  if (options[name] === undefined || options[name] === '') {
    throw new UsageError(
      `${command} requires --${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`
    );
  }
  return options[name];
}

/**
 * `session.launch` params from browser options (`--arg` → `args`,
 * `--restriction` → `restrictions`), with unset options left out.
 */
export function launchParams(options) {
  const settings = (entries, flag) => {
    if (entries === undefined) {
      return undefined;
    }
    const result = {};
    for (const entry of entries) {
      const separator = entry.indexOf('=');
      const path = entry.slice(0, separator).split('.');
      if (
        separator < 1 ||
        path.some(
          (part) =>
            !part || ['__proto__', 'prototype', 'constructor'].includes(part)
        )
      ) {
        throw new UsageError(`${flag} requires a dotted key=value`);
      }
      let value = entry.slice(separator + 1);
      try {
        value = JSON.parse(value);
      } catch {
        // Unquoted CLI text is a string.
      }
      let parent = result;
      for (const part of path.slice(0, -1)) {
        parent[part] ??= {};
        if (
          !parent[part] ||
          typeof parent[part] !== 'object' ||
          Array.isArray(parent[part])
        ) {
          throw new UsageError(`${flag} has a conflicting key: ${entry}`);
        }
        parent = parent[part];
      }
      parent[path.at(-1)] = value;
    }
    return result;
  };
  const params = {
    engine: options.engine,
    browser: options.browser,
    executablePath: options.executablePath,
    userDataDir: options.userDataDir,
    headless: options.headless,
    launch: options.launch,
    restrictions: options.restriction,
    args: options.arg,
    preferences: settings(options.pref, '--pref'),
    localState: settings(options.localState, '--local-state'),
    defaultBrowserCheck: options.defaultBrowserCheck,
    firstRun: options.firstRun,
    driverPath: options.driverPath,
    bidi: options.bidi,
  };
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined)
  );
}

/**
 * The `attach` launch param of `launch --attach snapshot --from BROWSER
 * --profile NAME`, or undefined without `--attach`.
 *
 * @throws {UsageError}
 */
export function launchAttachParams(options) {
  if (options.attach === undefined) {
    if (options.from !== undefined || options.profile !== undefined) {
      throw new UsageError(
        'launch: --from and --profile need --attach snapshot'
      );
    }
    return undefined;
  }
  if (options.attach !== 'snapshot') {
    throw new UsageError(
      `launch: --attach supports "snapshot", got "${options.attach}"; use attach --mode extension or open <url> for the other modes`
    );
  }
  if (options.userDataDir !== undefined) {
    throw new UsageError(
      'launch: --attach snapshot and --user-data-dir are mutually exclusive'
    );
  }
  if (options.launch === 'engine') {
    throw new UsageError(
      'launch: --attach snapshot needs --launch real; an engine launch starts its own profile'
    );
  }
  return Object.fromEntries(
    Object.entries({
      mode: 'snapshot',
      browser: options.from,
      profile: options.profile,
    }).filter(([, value]) => value !== undefined)
  );
}

/**
 * A non-negative integer option such as `--port 9333`, or undefined.
 *
 * @throws {UsageError}
 */
export function integerOption(options, name, command) {
  const value = options[name];
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/u.test(value)) {
    throw new UsageError(`${command}: --${name} must be an integer`);
  }
  return Number.parseInt(value, 10);
}
