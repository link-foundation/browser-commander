#!/usr/bin/env node

/**
 * Read a single field out of a package manifest, table-aware and fail-loud.
 *
 * Release jobs used to scrape versions with
 * `grep -Po '(?<=^version = ")[^"]*' pyproject.toml`. That regex is anchored to
 * the start of a line but not to a TOML table, so it matches `version` in
 * *every* table. `python/pyproject.toml` carries two of them:
 *
 *   [project]      version = "0.5.3"
 *   [tool.scriv]   version = "literal: pyproject.toml: project.version"
 *
 * The step then wrote two lines into `$GITHUB_OUTPUT`, which GitHub rejects
 * with `Unable to process file command 'output' successfully` /
 * `Invalid format 'literal: pyproject.toml: project.version'`, failing every
 * Python release since the scriv key was added. Adding `head -1` would only
 * hide the ordering dependency: a manifest that lists the metadata table after
 * another `version` key would silently release the wrong number.
 *
 * This reader instead tracks the active TOML table and returns the key from the
 * table that owns it, and it refuses to emit an empty or multi-line value, so a
 * manifest it cannot parse fails the job instead of releasing something wrong.
 *
 * The repository keeps this script dependency-free so release jobs can run it
 * before any package install. It implements only the TOML subset the manifests
 * use (single-line string values in named tables), not the full grammar.
 *
 * Usage:
 *   node scripts/read-manifest.mjs python/pyproject.toml
 *   node scripts/read-manifest.mjs rust/Cargo.toml --field name
 *   node scripts/read-manifest.mjs js/package.json --output version
 *
 * With --output, the value is appended to $GITHUB_OUTPUT as `<name>=<value>`.
 */

import { appendFileSync, readFileSync } from 'fs';
import { basename } from 'path';
import { pathToFileURL } from 'url';

/** TOML table that owns the package metadata, per manifest file name. */
const DEFAULT_TABLES = {
  'pyproject.toml': 'project',
  'Cargo.toml': 'package',
};

/**
 * Strip an unquoted `#` comment and surrounding whitespace from a TOML line.
 * A `#` inside a quoted value is part of the value, not a comment.
 * @param {string} line
 * @returns {string}
 */
function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '#') {
      return line.slice(0, index).trim();
    }
  }
  return line.trim();
}

/**
 * Read `field` from `table` in a TOML document.
 *
 * @param {string} content TOML source
 * @param {string} table table name, e.g. `project` or `package`
 * @param {string} field key to read inside that table
 * @returns {string | undefined} the unquoted value, or undefined when absent
 */
export function readTomlField(content, table, field) {
  let currentTable = '';

  for (const rawLine of content.split('\n')) {
    const line = stripComment(rawLine);
    if (line === '') continue;

    // `[[bin]]` is an array-of-tables header; both forms change the scope.
    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      currentTable = header[1].trim();
      continue;
    }

    if (currentTable !== table) continue;

    const assignment = new RegExp(`^${field}\\s*=\\s*(.*)$`).exec(line);
    if (!assignment) continue;

    const value = assignment[1].trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    return quoted ? quoted[2] : value;
  }

  return undefined;
}

/**
 * Rewrite `field` inside `table` only, leaving every other table untouched.
 *
 * A whole-file substitution also rewrites metadata keys that happen to share
 * the name -- `[tool.scriv] version` is a scriv directive, not a version
 * number, and overwriting it silently breaks changelog collection.
 *
 * @param {string} content TOML source
 * @param {string} table table name, e.g. `package`
 * @param {string} field key to rewrite inside that table
 * @param {string} newValue replacement value, inserted between the quotes
 * @returns {string} the updated TOML source
 * @throws {Error} when the table does not declare the field
 */
export function replaceTomlField(content, table, field, newValue) {
  const lines = content.split('\n');
  let currentTable = '';

  for (const [index, rawLine] of lines.entries()) {
    const line = stripComment(rawLine);
    if (line === '') continue;

    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      currentTable = header[1].trim();
      continue;
    }

    if (currentTable !== table) continue;
    if (!new RegExp(`^${field}\\s*=`).test(line)) continue;

    lines[index] = rawLine.replace(
      new RegExp(`^(\\s*${field}\\s*=\\s*["'])[^"']*(["'])`),
      `$1${newValue}$2`
    );
    return lines.join('\n');
  }

  throw new Error(`No [${table}] ${field} to update`);
}

/**
 * Read `field` from a JSON manifest (package.json).
 * @param {string} content JSON source
 * @param {string} field top-level key to read
 * @returns {string | undefined}
 */
export function readJsonField(content, field) {
  const value = JSON.parse(content)[field];
  return value === undefined ? undefined : String(value);
}

/**
 * Read one metadata field from a manifest file.
 *
 * @param {string} manifestPath path to package.json, pyproject.toml or Cargo.toml
 * @param {{field?: string, table?: string, readFile?: (path: string) => string}} [options]
 * @returns {string} the field value, guaranteed non-empty and single-line
 * @throws {Error} when the field is missing, empty or spans multiple lines
 */
export function readManifestField(manifestPath, options = {}) {
  const {
    field = 'version',
    table = DEFAULT_TABLES[basename(manifestPath)],
    readFile = (path) => readFileSync(path, 'utf8'),
  } = options;

  const content = readFile(manifestPath);
  const value = manifestPath.endsWith('.json')
    ? readJsonField(content, field)
    : readTomlField(content, table ?? 'package', field);

  if (value === undefined || value === '') {
    throw new Error(
      `${manifestPath} has no non-empty "${field}"` +
        (manifestPath.endsWith('.json') ? '' : ` in [${table ?? 'package'}]`) +
        '. Refusing to continue: an empty version would tag and publish the ' +
        'wrong release.'
    );
  }

  if (/[\r\n]/.test(value)) {
    throw new Error(
      `${manifestPath} produced a multi-line "${field}": ${JSON.stringify(value)}. ` +
        'GitHub Actions rejects multi-line values written with `key=value`.'
    );
  }

  return value;
}

/**
 * Parse the CLI arguments of this script.
 * @param {string[]} argv arguments after the script name
 * @returns {{manifest: string, field: string, table?: string, output?: string}}
 */
export function parseArguments(argv) {
  const positional = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith('--')) {
      const [name, inlineValue] = argument.slice(2).split('=');
      flags[name] = inlineValue ?? argv[++index];
    } else {
      positional.push(argument);
    }
  }

  if (positional.length !== 1) {
    throw new Error(
      'Usage: node scripts/read-manifest.mjs <manifest> [--field version] ' +
        '[--table project] [--output name]'
    );
  }

  return {
    manifest: positional[0],
    field: flags.field ?? 'version',
    table: flags.table,
    output: flags.output,
  };
}

export function main(argv = process.argv.slice(2)) {
  const { manifest, field, table, output } = parseArguments(argv);
  const value = readManifestField(manifest, { field, table });

  if (output && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${output}=${value}\n`);
  }

  process.stdout.write(`${value}\n`);
  return value;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
