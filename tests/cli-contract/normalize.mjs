#!/usr/bin/env node
/**
 * Normalize `browser-commander run` output for the cross-language CLI
 * contract (docs/cli-and-bridge.md, issue #104).
 *
 * Values that differ between machines, runs or languages - endpoints, ports,
 * profile directories, paths, command lines, stacks - are replaced with
 * "<volatile>", and `version` results keep only the package name. What is
 * left must be byte-identical for the JS, Rust and Python CLIs.
 *
 * Usage:
 *   browser-commander run tests/cli-contract/basic.json | node tests/cli-contract/normalize.mjs
 *
 * Or import `normalizeRunOutput()`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Keys whose values are replaced wherever they appear. */
export const VOLATILE_KEYS = Object.freeze([
  'cdpEndpoint',
  'remoteDebuggingPort',
  'userDataDir',
  'executablePath',
  'path',
  'args',
  'stack',
]);

export const VOLATILE = '<volatile>';

function normalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      VOLATILE_KEYS.includes(key) ? VOLATILE : normalizeValue(item),
    ])
  );
}

function normalizeEntry(entry) {
  if (entry?.method === 'version' && entry.result) {
    return { method: 'version', result: { name: entry.result.name } };
  }
  return normalizeValue(entry);
}

/**
 * Normalize a `{"results": [...]}` document.
 *
 * @param {{results: Object[]}} document
 * @returns {{results: Object[]}}
 */
export function normalizeRunOutput(document) {
  return { results: (document?.results ?? []).map(normalizeEntry) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = readFileSync(process.argv[2] ?? 0, 'utf8');
  process.stdout.write(
    `${JSON.stringify(normalizeRunOutput(JSON.parse(input)), null, 2)}\n`
  );
}
