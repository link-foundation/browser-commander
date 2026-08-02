#!/usr/bin/env node

/**
 * Reject manual version bumps in pull requests.
 *
 * Every published version in this repository is produced by the release jobs:
 * js/package.json from changesets, python/pyproject.toml and rust/Cargo.toml
 * from the auto-release jobs. A version edited by hand in a pull request either
 * collides with the number the pipeline is about to pick, or silently skips a
 * number, and in both cases the tag, the changelog and the registry disagree
 * about what a release contains.
 *
 * The check is language-agnostic on purpose: this is a monorepo, and running
 * one job over all three manifests keeps the rule from drifting apart across
 * js.yml, python.yml and rust.yml the way per-language copies would.
 *
 * Usage:
 *   GITHUB_BASE_REF=main GITHUB_HEAD_REF=my-branch node scripts/check-version-modification.mjs
 *
 * Exit codes:
 *   0 - no manual version change (or the branch is an automated release branch)
 *   1 - a manual version change was found
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Each manifest declares its version with a different syntax, so the pattern
// that recognises an *added* version line differs per file. All three require a
// numeric first component so that unrelated `version` keys -- for example
// pyproject's `version = "literal: pyproject.toml: project.version"` -- do not
// match.
const MANIFESTS = [
  {
    path: 'js/package.json',
    pattern: /^\+\s*"version"\s*:\s*"\d[^"]*"/m,
  },
  {
    path: 'python/pyproject.toml',
    pattern: /^\+\s*version\s*=\s*"\d[^"]*"/m,
  },
  {
    path: 'rust/Cargo.toml',
    pattern: /^\+\s*version\s*=\s*"\d[^"]*"/m,
  },
];

// Branches the release pipeline itself opens. Their whole purpose is to change
// a version, so the check would otherwise block every release.
const AUTOMATED_RELEASE_BRANCH_PREFIXES = [
  'changeset-release/',
  'changeset-manual-release-',
];

function gitDiff(baseRef, path) {
  try {
    return execFileSync(
      'git',
      ['diff', `origin/${baseRef}...HEAD`, '--', path],
      { encoding: 'utf8' }
    );
  } catch (error) {
    // A manifest that does not exist on either side produces no diff, which is
    // not a failure. Anything else is worth surfacing rather than swallowing.
    console.error(`Could not diff ${path}: ${error.message}`);
    return '';
  }
}

export function findManualVersionChanges(baseRef, diff = gitDiff) {
  return MANIFESTS.filter(({ path, pattern }) =>
    pattern.test(diff(baseRef, path))
  ).map(({ path }) => path);
}

export function main() {
  const headRef = process.env.GITHUB_HEAD_REF || '';
  const baseRef = process.env.GITHUB_BASE_REF || 'main';

  const automatedPrefix = AUTOMATED_RELEASE_BRANCH_PREFIXES.find((prefix) =>
    headRef.startsWith(prefix)
  );
  if (automatedPrefix) {
    console.log(
      `Skipping: ${headRef} is an automated release branch (${automatedPrefix}*).`
    );
    return;
  }

  const changed = findManualVersionChanges(baseRef);

  if (changed.length === 0) {
    console.log('No manual version changes detected.');
    return;
  }

  for (const path of changed) {
    console.error(
      `::error file=${path}::Manual version change detected in ${path}. Versions are set by the release pipeline, not by hand.`
    );
  }
  console.error('');
  console.error('How to fix:');
  console.error(`  1. Revert the version field in: ${changed.join(', ')}`);
  console.error(
    '  2. Describe the change instead, so the pipeline can pick the number:'
  );
  console.error('     - JavaScript: npx changeset');
  console.error('     - Python:     scriv create (python/changelog.d)');
  console.error('     - Rust:       add a fragment under rust/changelog.d');
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
