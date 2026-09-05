#!/usr/bin/env node

/**
 * Bump version in Cargo.toml and commit changes
 * Used by the CI/CD pipeline for releases
 *
 * Usage: node scripts/version-and-commit.mjs --bump-type <major|minor|patch> [--description <desc>]
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync, writeFileSync, appendFileSync } from 'fs';

import {
  readManifestField,
  replaceTomlField,
} from '../../scripts/read-manifest.mjs';
import { releaseTag } from '../../scripts/release-tags.mjs';
import {
  loadCommandStream,
  loadLinoArguments,
} from '../../scripts/use-module.mjs';

import {
  collectFragments,
  removeFragments,
  updateChangelog,
} from './changelog.mjs';

const { $ } = await loadCommandStream();
const { makeConfig } = await loadLinoArguments();

// Parse CLI arguments
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('bump-type', {
        type: 'string',
        default: getenv('BUMP_TYPE', ''),
        describe: 'Version bump type: major, minor, or patch',
        choices: ['major', 'minor', 'patch'],
      })
      .option('description', {
        type: 'string',
        default: getenv('DESCRIPTION', ''),
        describe: 'Release description',
      }),
});

const { bumpType, description } = config;

if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
  console.error(
    'Usage: node scripts/version-and-commit.mjs --bump-type <major|minor|patch> [--description <desc>]'
  );
  process.exit(1);
}

/**
 * Append to GitHub Actions output file
 * @param {string} key
 * @param {string} value
 */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`Output: ${key}=${value}`);
}

/**
 * Get current version from Cargo.toml
 * @returns {{major: number, minor: number, patch: number}}
 */
function getCurrentVersion() {
  let version;
  try {
    version = readManifestField('Cargo.toml');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    console.error(`Error: [package] version "${version}" is not semver`);
    process.exit(1);
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/**
 * Calculate new version based on bump type
 * @param {{major: number, minor: number, patch: number}} current
 * @param {string} bumpType
 * @returns {string}
 */
function calculateNewVersion(current, bumpType) {
  const { major, minor, patch } = current;

  switch (bumpType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${bumpType}`);
  }
}

/**
 * Update version in Cargo.toml
 * @param {string} newVersion
 */
function updateCargoToml(newVersion) {
  const cargoToml = readFileSync('Cargo.toml', 'utf-8');
  writeFileSync(
    'Cargo.toml',
    replaceTomlField(cargoToml, 'package', 'version', newVersion),
    'utf-8'
  );
  console.log(`Updated Cargo.toml to version ${newVersion}`);
}

/**
 * Check if a version is published on crates.io
 * @param {string} crateName
 * @param {string} version
 * @returns {Promise<boolean>}
 */
async function checkVersionOnCratesIo(crateName, version) {
  try {
    const response = await fetch(
      `https://crates.io/api/v1/crates/${crateName}/${version}`,
      {
        headers: {
          'User-Agent':
            'browser-commander-ci (github.com/link-foundation/browser-commander)',
        },
      }
    );
    if (response.ok) {
      const data = await response.json();
      return Boolean(data.version);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Find the next available version that is not yet published on crates.io
 * @param {string} crateName
 * @param {{major: number, minor: number, patch: number}} current
 * @param {string} bumpType
 * @returns {Promise<string>}
 */
async function findNextAvailableVersion(crateName, current, bumpType) {
  const MAX_ATTEMPTS = 20;
  let version = calculateNewVersion(current, bumpType);
  let attempts = 0;

  while (await checkVersionOnCratesIo(crateName, version)) {
    attempts++;
    if (attempts >= MAX_ATTEMPTS) {
      throw new Error(
        `Could not find an available version after ${MAX_ATTEMPTS} attempts (last tried: ${version})`
      );
    }
    // Reaching here means Cargo.toml is behind what is actually published,
    // i.e. a previous release bumped and published without committing. The
    // walk keeps the release moving, but it is a symptom, not normal
    // operation, so say so where CI log readers will see it.
    console.warn(
      `::warning::Version ${version} is already published on crates.io but ` +
        `Cargo.toml does not reflect it; the working tree is behind the registry. ` +
        `Trying the next patch version...`
    );
    const parts = version.split('.').map(Number);
    const next = { major: parts[0], minor: parts[1], patch: parts[2] };
    version = calculateNewVersion(next, 'patch');
  }

  return version;
}

async function main() {
  try {
    // Configure git
    await $`git config user.name "github-actions[bot]"`;
    await $`git config user.email "github-actions[bot]@users.noreply.github.com"`;

    const current = getCurrentVersion();
    const currentVersionStr = `${current.major}.${current.minor}.${current.patch}`;

    // Read [package].name: Cargo.toml repeats `name` under [[bin]] and [lib].
    const crateName = readManifestField('Cargo.toml', { field: 'name' });

    // Check if the current version is already published on crates.io
    if (await checkVersionOnCratesIo(crateName, currentVersionStr)) {
      console.log(
        `Current version ${currentVersionStr} is already published on crates.io`
      );
    } else {
      console.log(
        `Current version ${currentVersionStr} is NOT published on crates.io`
      );
    }

    // Find the next version that is not yet published on crates.io
    const newVersion = await findNextAvailableVersion(
      crateName,
      current,
      bumpType
    );
    console.log(`Next available version: ${newVersion}`);

    // Update version in Cargo.toml
    updateCargoToml(newVersion);

    // Cargo.lock records the workspace member's own version, so a bump that
    // touches only Cargo.toml leaves the two disagreeing. Every job that runs
    // `cargo build --locked` on the release commit then fails with "the lock
    // file needs to be updated but --locked was passed". `--workspace`
    // rewrites only the member entry and leaves the dependency graph alone.
    await $`cargo update --workspace`;
    console.log(`Updated Cargo.lock to version ${newVersion}`);

    // Collect changelog fragments and consume them. Without the removal the
    // next release re-collects the same fragments and ships duplicate notes.
    const fragments = collectFragments();
    if (fragments) {
      updateChangelog('.', newVersion, fragments);
      removeFragments();
    } else {
      console.log('No changelog fragments found');
    }

    // Stage the version bump, the lockfile, the changelog and the fragment
    // deletions.
    await $`git add -A Cargo.toml Cargo.lock CHANGELOG.md changelog.d`;

    // Check whether anything was actually staged. Branching on the output of
    // `git status --porcelain` rather than on the exit code of
    // `git diff --cached --quiet` keeps this correct no matter how the shell
    // wrapper reports non-zero exits.
    const staged = await $`git diff --cached --name-only`;
    const stagedFiles = String(staged.stdout ?? '').trim();
    if (!stagedFiles) {
      console.log('No changes to commit');
      setOutput('version_committed', 'false');
      setOutput('new_version', newVersion);
      return;
    }
    console.log(`Staged for release commit:\n${stagedFiles}`);

    // Commit changes
    const commitMsg = description
      ? `chore: release v${newVersion}\n\n${description}`
      : `chore: release v${newVersion}`;
    await $`git commit -m ${commitMsg}`;
    console.log(`Committed version ${newVersion}`);

    // Create tag. The crate has its own namespace: tagging `v<version>` put
    // it in the JS package's namespace, where `git tag` refused to recreate a
    // name JS had already taken and the release went out untagged.
    const tag = releaseTag('rust', newVersion);
    const tagMsg = description
      ? `Release ${tag}\n\n${description}`
      : `Release ${tag}`;
    await $`git tag -a ${tag} -m ${tagMsg}`;
    console.log(`Created tag ${tag}`);

    // Push changes and tag
    await $`git push`;
    await $`git push --tags`;
    console.log('Pushed changes and tags');

    setOutput('version_committed', 'true');
    setOutput('new_version', newVersion);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
