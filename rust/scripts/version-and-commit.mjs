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

import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// Load use-m dynamically
const { use } = eval(
  await (await fetch('https://unpkg.com/use-m/use.js')).text()
);

// Import link-foundation libraries
const { $ } = await use('command-stream');
const { makeConfig } = await use('lino-arguments');

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
  const cargoToml = readFileSync('Cargo.toml', 'utf-8');
  const match = cargoToml.match(/^version\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m);

  if (!match) {
    console.error('Error: Could not parse version from Cargo.toml');
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
  let cargoToml = readFileSync('Cargo.toml', 'utf-8');
  cargoToml = cargoToml.replace(
    /^(version\s*=\s*")[^"]+(")/m,
    `$1${newVersion}$2`
  );
  writeFileSync('Cargo.toml', cargoToml, 'utf-8');
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
      `https://crates.io/api/v1/crates/${crateName}/${version}`
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
  let version = calculateNewVersion(current, bumpType);

  while (await checkVersionOnCratesIo(crateName, version)) {
    console.log(`Version ${version} already published on crates.io, trying next...`);
    const parts = version.split('.').map(Number);
    const next = { major: parts[0], minor: parts[1], patch: parts[2] };
    version = calculateNewVersion(next, 'patch');
  }

  return version;
}

/**
 * Strip frontmatter from markdown content
 * @param {string} content - Markdown content potentially with frontmatter
 * @returns {string} - Content without frontmatter
 */
function stripFrontmatter(content) {
  const frontmatterMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
  if (frontmatterMatch) {
    return frontmatterMatch[1].trim();
  }
  return content.trim();
}

/**
 * Collect changelog fragments and update CHANGELOG.md
 * @param {string} version
 */
function collectChangelog(version) {
  const changelogDir = 'changelog.d';
  const changelogFile = 'CHANGELOG.md';

  if (!existsSync(changelogDir)) {
    return;
  }

  const files = readdirSync(changelogDir).filter(
    (f) => f.endsWith('.md') && f !== 'README.md'
  );

  if (files.length === 0) {
    return;
  }

  const fragments = files
    .sort()
    .map((f) => {
      const rawContent = readFileSync(join(changelogDir, f), 'utf-8');
      // Strip frontmatter (which contains bump type metadata)
      return stripFrontmatter(rawContent);
    })
    .filter(Boolean)
    .join('\n\n');

  if (!fragments) {
    return;
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const newEntry = `\n## [${version}] - ${dateStr}\n\n${fragments}\n`;

  if (existsSync(changelogFile)) {
    let content = readFileSync(changelogFile, 'utf-8');
    const lines = content.split('\n');
    let insertIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('## [')) {
        insertIndex = i;
        break;
      }
    }

    if (insertIndex >= 0) {
      lines.splice(insertIndex, 0, newEntry);
      content = lines.join('\n');
    } else {
      content += newEntry;
    }

    writeFileSync(changelogFile, content, 'utf-8');
  }

  console.log(`Collected ${files.length} changelog fragment(s)`);
}

async function main() {
  try {
    // Configure git
    await $`git config user.name "github-actions[bot]"`;
    await $`git config user.email "github-actions[bot]@users.noreply.github.com"`;

    const current = getCurrentVersion();
    const currentVersionStr = `${current.major}.${current.minor}.${current.patch}`;

    // Get crate name from Cargo.toml
    const cargoToml = readFileSync('Cargo.toml', 'utf-8');
    const nameMatch = cargoToml.match(/^name\s*=\s*"([^"]+)"/m);
    const crateName = nameMatch ? nameMatch[1] : 'unknown';

    // Check if the current version is already published on crates.io
    if (await checkVersionOnCratesIo(crateName, currentVersionStr)) {
      console.log(`Current version ${currentVersionStr} is already published on crates.io`);
    } else {
      console.log(`Current version ${currentVersionStr} is NOT published on crates.io`);
    }

    // Find the next version that is not yet published on crates.io
    const newVersion = await findNextAvailableVersion(crateName, current, bumpType);
    console.log(`Next available version: ${newVersion}`);

    // Update version in Cargo.toml
    updateCargoToml(newVersion);

    // Collect changelog fragments
    collectChangelog(newVersion);

    // Stage Cargo.toml and CHANGELOG.md
    await $`git add Cargo.toml CHANGELOG.md`;

    // Check if there are changes to commit
    try {
      await $`git diff --cached --quiet`.run({ capture: true });
      // No changes to commit
      console.log('No changes to commit');
      setOutput('version_committed', 'false');
      setOutput('new_version', newVersion);
      return;
    } catch {
      // There are changes to commit (git diff exits with 1 when there are differences)
    }

    // Commit changes
    const commitMsg = description
      ? `chore: release v${newVersion}\n\n${description}`
      : `chore: release v${newVersion}`;
    await $`git commit -m ${commitMsg}`;
    console.log(`Committed version ${newVersion}`);

    // Create tag
    const tagMsg = description
      ? `Release v${newVersion}\n\n${description}`
      : `Release v${newVersion}`;
    await $`git tag -a v${newVersion} -m ${tagMsg}`;
    console.log(`Created tag v${newVersion}`);

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
