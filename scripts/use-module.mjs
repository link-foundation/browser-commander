#!/usr/bin/env node

/**
 * Interop shim around `use-m`.
 *
 * `use-m` resolves a package with `createRequire(...).resolve` and imports the
 * resolved file, so a dual package such as `command-stream@>=0.19.0` loads
 * through its **CommonJS** entry point. It unwraps the callable `default` only
 * when the namespace carries nothing but known metadata keys.
 *
 * Node.js 23+ adds a synthetic `'module.exports'` named export to CommonJS
 * namespaces whose names `cjs-module-lexer` cannot infer
 * (https://nodejs.org/api/esm.html#commonjs-namespaces). That extra key is not
 * in the metadata set of `use-m`, so the unwrap is skipped. Measured against
 * `command-stream` with experiments/ci-repro/repro-command-stream-dollar.mjs:
 *
 *   node v20.20.2  -> 32 keys                           typeof loaded.$ : function
 *   node v22.21.1  -> 32 keys                           typeof loaded.$ : function
 *   node v24.20.0  -> keys [default, 'module.exports']  typeof loaded.$ : undefined
 *
 * On Node 24 — the version every workflow in this repository requests —
 * `const { $ } = await use('command-stream')` therefore yields `undefined` and
 * the first tagged template dies with `TypeError: $ is not a function`. That is
 * what broke the JS release and the Rust auto-release jobs on 2026-09-04.
 * Upstream tracker: https://github.com/link-foundation/use-m/issues/72
 *
 * This module normalises every shape observed so far (Node 20, 22, 24 and Bun)
 * and, when nothing callable is found, fails with an error naming the keys it
 * did see, in place of the opaque `$ is not a function`.
 *
 * Set CI_SCRIPTS_DEBUG=1 to trace the resolved module shape (default off).
 *
 * Usage (from js/scripts or rust/scripts):
 *   import { loadCommandStream } from '../../scripts/use-module.mjs';
 *   const { $ } = await loadCommandStream();
 */

import { debug, isDebugEnabled } from './debug-print.mjs';

/** Unpinned CDN entry point for use-m, kept in one place. */
export const USE_M_URL = 'https://unpkg.com/use-m/use.js';

/** Cached `use` function, so a process fetches use.js at most once. */
let cachedUse = null;

/**
 * Candidate containers for the real module object, in resolution order.
 * `module.exports` is the Node >= 22.12 synthetic CommonJS export.
 * @param {unknown} loaded
 * @returns {unknown[]}
 */
function candidates(loaded) {
  return [
    loaded,
    loaded?.default,
    loaded?.['module.exports'],
    loaded?.default?.default,
  ];
}

/**
 * Human-readable description of a loaded module, used in error messages.
 * @param {unknown} loaded
 * @returns {string}
 */
export function describeModule(loaded) {
  if (loaded === null || loaded === undefined) {
    return String(loaded);
  }
  if (typeof loaded !== 'object' && typeof loaded !== 'function') {
    return typeof loaded;
  }
  return `${typeof loaded} with keys [${Object.keys(loaded).join(', ')}]`;
}

/**
 * Pick the object that actually carries `exportName` out of whatever `use-m`
 * returned for `moduleName`.
 *
 * @param {unknown} loaded value returned by `await use(moduleName)`
 * @param {string} exportName named export the caller needs
 * @param {string} moduleName package name, used for the error message only
 * @returns {Record<string, unknown>} object exposing `exportName`
 */
export function resolveNamedExport(loaded, exportName, moduleName) {
  for (const candidate of candidates(loaded)) {
    if (candidate && typeof candidate[exportName] === 'function') {
      debug(`resolved ${moduleName}.${exportName}`, {
        received: describeModule(loaded),
        via: candidate === loaded ? 'namespace' : 'unwrapped',
      });
      return candidate;
    }
  }
  throw new Error(
    `use('${moduleName}') did not expose a callable "${exportName}". ` +
      `Received ${describeModule(loaded)}. This usually means the CommonJS ` +
      `interop of use-m did not unwrap the module (see scripts/use-module.mjs).`
  );
}

/**
 * Fetch and evaluate use-m, caching the result for the whole process.
 *
 * A non-2xx response is reported as an HTTP failure; eval-ing an error page as
 * JavaScript would only produce an opaque `SyntaxError`.
 *
 * @param {{fetchImpl?: typeof fetch, url?: string}} [options] injection seam for tests
 * @returns {Promise<(name: string) => Promise<unknown>>}
 */
export async function loadUse(options = {}) {
  const { fetchImpl = fetch, url = USE_M_URL } = options;
  if (cachedUse && !options.fetchImpl) {
    return cachedUse;
  }
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch use-m from ${url}: ${response.status} ${response.statusText || ''}`.trim()
    );
  }
  const source = await response.text();
  // use-m ships as an eval-able bundle; this is its documented entry point.
  const evaluated = await eval(source);
  const use = evaluated?.use ?? evaluated?.default?.use;
  if (typeof use !== 'function') {
    throw new Error(
      `use-m loaded from ${url} did not export a callable "use". ` +
        `Received ${describeModule(evaluated)}.`
    );
  }
  debug('loaded use-m', { url });
  if (!options.fetchImpl) {
    cachedUse = use;
  }
  return use;
}

/**
 * Load a package through use-m and return it with CommonJS namespaces
 * normalised around a named export the caller needs.
 *
 * @param {string} moduleName package specifier passed to use-m
 * @param {string} exportName named export that must be callable
 * @param {(name: string) => Promise<unknown>} [use] pre-loaded use-m function
 * @returns {Promise<Record<string, unknown>>}
 */
export async function useModule(moduleName, exportName, use) {
  const resolvedUse = use ?? (await loadUse());
  return resolveNamedExport(
    await resolvedUse(moduleName),
    exportName,
    moduleName
  );
}

/**
 * All the text a `command-stream` rejection carries, as one string.
 *
 * With `errexit` on, a failed command rejects with
 *
 *   message : "Command failed with exit code 101"
 *   code    : 101
 *   stdout  : ""
 *   stderr  : "error: crate version 0.10.11 is already uploaded"
 *
 * The reason a caller needs to branch on — "already exists", "already
 * uploaded" — is in `stderr` or `stdout`, never in `message`. Call sites that
 * test `error.message.includes(...)` therefore stop matching as soon as the
 * promise genuinely rejects, which would turn a harmless re-run over an
 * already-published version into a failed release. Use this instead.
 *
 * @param {unknown} error value caught from an awaited `$` call
 * @returns {string} message, stdout and stderr joined; empty for nullish input
 */
export function commandErrorText(error) {
  if (error === null || error === undefined) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }
  const parts = [error.message, error.stdout, error.stderr]
    .map((part) => (part === null || part === undefined ? '' : String(part)))
    .filter(Boolean);
  return parts.join('\n');
}

/**
 * Load `command-stream` with `$` guaranteed to be callable **and to fail on a
 * non-zero exit code**.
 *
 * `command-stream` resolves its promise on a non-zero exit rather than
 * rejecting, which is the opposite of what `zx` and `execa` do and the opposite
 * of what every consumer in this repository assumes. Each of them is written
 * as
 *
 *   try { await $`some-command`; } catch { process.exit(1); }
 *
 * and under the library default that `catch` is unreachable. The consequences
 * were not theoretical: a crashed `changeset version` was reported as a
 * successful JS release, and a Rust release that never committed its version
 * bump published to crates.io anyway. See
 * dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-B and RC-C.
 *
 * Enabling `errexit` here — the one place every consumer obtains `$` from —
 * restores the assumption those scripts are written against. A caller that
 * genuinely wants to inspect a failing exit code should read it from the
 * rejection (`error.code`) rather than expect the promise to resolve.
 *
 * `CI_SCRIPTS_DEBUG=1` additionally turns on the shell's own `verbose` and
 * `xtrace`, so a failing release job logs the commands it ran. Default off.
 *
 * @param {(name: string) => Promise<unknown>} [use] pre-loaded use-m function
 * @returns {Promise<Record<string, unknown>>} command-stream exports
 */
export async function loadCommandStream(use) {
  const commandStream = await useModule('command-stream', '$', use);

  // `shell` is absent from no released version we support, but a missing or
  // renamed control surface must not turn into `undefined is not a function`
  // inside a release job.
  const shell = commandStream.shell;
  if (shell && typeof shell.errexit === 'function') {
    shell.errexit(true);
    if (isDebugEnabled()) {
      shell.verbose?.(true);
      shell.xtrace?.(true);
    }
    debug('configured command-stream shell', {
      settings: shell.settings?.(),
    });
  } else {
    debug('command-stream exposes no shell.errexit; failures may not reject', {
      received: describeModule(shell),
    });
  }

  return commandStream;
}

/**
 * Load `lino-arguments` with `makeConfig` guaranteed to be callable.
 *
 * @param {(name: string) => Promise<unknown>} [use] pre-loaded use-m function
 * @returns {Promise<Record<string, unknown>>} lino-arguments exports
 */
export function loadLinoArguments(use) {
  return useModule('lino-arguments', 'makeConfig', use);
}
