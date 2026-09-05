#!/usr/bin/env node
/**
 * Locates the Node version that starts adding the synthetic `'module.exports'`
 * named export to CommonJS namespaces (https://nodejs.org/api/esm.html#commonjs-namespaces).
 *
 * That extra key is what breaks `const { $ } = await use('command-stream')`
 * (RC-2): use-m only unwraps `module.default` when every other key is one it
 * recognises as metadata, and `'module.exports'` is not on that list.
 *
 * This reproduction deliberately avoids use-m and command-stream, so it shows
 * the Node behaviour on its own:
 *
 *   $ node experiments/ci-repro/node-module-exports-namespace-boundary.mjs
 *   v22.23.2 ["default"]
 *   v23.11.1 ["default","module.exports"]
 *
 * Run it under each Node version you care about, for example with
 * `npx --yes node@23 experiments/ci-repro/node-module-exports-namespace-boundary.mjs`.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Re-exporting a second file is what defeats cjs-module-lexer: it cannot infer
// the named exports statically, so Node falls back to the synthetic key.
const INNER =
  'const shell = {};\nshell.$ = function () {};\nmodule.exports = shell;\n';
const OUTER = "module.exports = require('./inner.cjs');\n";

const directory = await mkdtemp(join(tmpdir(), 'cjs-namespace-'));
await writeFile(join(directory, 'inner.cjs'), INNER);
await writeFile(join(directory, 'outer.cjs'), OUTER);

const namespace = await import(
  pathToFileURL(join(directory, 'outer.cjs')).href
);
console.log(process.version, JSON.stringify(Object.keys(namespace)));
