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
 *   1 - a manual version change was found, or the diff could not be computed
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

// `git diff A...B -- path` exits 0 with no output for a path that exists on
// neither side, so a thrown error is never "nothing changed": it is a missing
// base ref or merge base. Reading it as an empty diff turned the check into a
// pass on exactly the checkouts that could not see the change (issue #128,
// link-foundation/rust-ai-driven-development-pipeline-template#174).
function gitDiff(baseRef, path) {
  return execFileSync('git', ['diff', `origin/${baseRef}...HEAD`, '--', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitFetchBase(baseRef) {
  execFileSync(
    'git',
    [
      'fetch',
      '--no-tags',
      'origin',
      `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );
}

export function findManualVersionChanges(baseRef, diff = gitDiff) {
  return MANIFESTS.filter(({ path, pattern }) => {
    let text;
    try {
      text = diff(baseRef, path);
    } catch (error) {
      const detail = String(error.stderr || error.message).trim();
      throw new Error(
        `Could not diff ${path} against origin/${baseRef}: ${detail}`,
        { cause: error }
      );
    }
    return pattern.test(text);
  }).map(({ path }) => path);
}

/**
 * Find manual version changes, fetching the base branch once if the first
 * diff fails (a shallow or single-branch checkout has no origin/<base>).
 * Throws when the diff still cannot be computed.
 */
export function checkVersionModification(
  baseRef,
  { diff = gitDiff, fetchBase = gitFetchBase } = {}
) {
  try {
    return findManualVersionChanges(baseRef, diff);
  } catch (error) {
    console.error(`${error.message}`);
    console.error(`Fetching origin/${baseRef} and retrying once.`);
    try {
      fetchBase(baseRef);
    } catch (fetchError) {
      console.error(`Fetching origin/${baseRef} failed: ${fetchError.message}`);
    }
    return findManualVersionChanges(baseRef, diff);
  }
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

  let changed;
  try {
    changed = checkVersionModification(baseRef);
  } catch (error) {
    console.error(`::error::${error.message.split('\n')[0]}`);
    console.error(
      'The version check could not see what this pull request changes, so it cannot pass.'
    );
    process.exitCode = 1;
    return;
  }

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
