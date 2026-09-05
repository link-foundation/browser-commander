#!/usr/bin/env node

/**
 * Create GitHub Release from CHANGELOG.md
 * Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository>
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync, existsSync } from 'fs';

import { TAG_PREFIXES } from '../../scripts/release-tags.mjs';
import {
  commandErrorText,
  loadCommandStream,
  loadLinoArguments,
} from '../../scripts/use-module.mjs';

const { $ } = await loadCommandStream();
const { makeConfig } = await loadLinoArguments();

// Parse CLI arguments
// Note: Using --release-version instead of --version to avoid conflict with yargs' built-in --version flag
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option('release-version', {
        type: 'string',
        default: getenv('VERSION', ''),
        describe: 'Version number (e.g., 1.0.0)',
      })
      .option('repository', {
        type: 'string',
        default: getenv('REPOSITORY', ''),
        describe: 'GitHub repository (e.g., owner/repo)',
      })
      .option('tag-prefix', {
        type: 'string',
        default: getenv('TAG_PREFIX', TAG_PREFIXES.rust),
        describe: 'Tag prefix (e.g., rust-v)',
      }),
});

const { releaseVersion: version, repository, tagPrefix } = config;

if (!version || !repository) {
  console.error('Error: Missing required arguments');
  console.error(
    'Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository>'
  );
  process.exit(1);
}

const tag = `${tagPrefix}${version}`;

console.log(`Creating GitHub release for ${tag}...`);

/**
 * Extract changelog content for a specific version
 * @param {string} version
 * @returns {string}
 */
function getChangelogForVersion(version) {
  const changelogPath = 'CHANGELOG.md';

  if (!existsSync(changelogPath)) {
    return `Release v${version}`;
  }

  const content = readFileSync(changelogPath, 'utf-8');

  // Find the section for this version
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `## \\[${escapedVersion}\\].*?\\n([\\s\\S]*?)(?=\\n## \\[|$)`
  );
  const match = content.match(pattern);

  if (match) {
    return match[1].trim();
  }

  return `Release v${version}`;
}

try {
  const releaseNotes = getChangelogForVersion(version);

  // Create release using GitHub API with JSON input
  // This avoids shell escaping issues
  const payload = JSON.stringify({
    tag_name: tag,
    name: tag,
    body: releaseNotes,
  });

  try {
    await $`gh api repos/${repository}/releases -X POST --input -`.run({
      stdin: payload,
    });
    console.log(`Created GitHub release: ${tag}`);
  } catch (error) {
    // Check if release already exists. `gh` reports this on stderr, which
    // command-stream does not fold into the rejection message.
    if (commandErrorText(error).includes('already exists')) {
      console.log(`Release ${tag} already exists, skipping`);
    } else {
      throw error;
    }
  }
} catch (error) {
  console.error('Error creating release:', error.message);
  process.exit(1);
}
