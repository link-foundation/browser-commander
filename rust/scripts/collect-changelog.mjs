#!/usr/bin/env node

/**
 * Collect changelog fragments into CHANGELOG.md
 * This script collects all .md files from changelog.d/ (except README.md)
 * and prepends them to CHANGELOG.md, then removes the processed fragments.
 *
 * The collection logic lives in ./changelog.mjs so that
 * version-and-commit.mjs (which the auto-release job runs) behaves
 * identically. See dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-C.
 */

import { readManifestField } from '../../scripts/read-manifest.mjs';

import {
  collectFragments,
  removeFragments,
  updateChangelog,
} from './changelog.mjs';

/**
 * Get version from Cargo.toml
 * @returns {string}
 */
function getVersionFromCargo() {
  try {
    return readManifestField('Cargo.toml');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

try {
  const version = getVersionFromCargo();
  console.log(`Collecting changelog fragments for version ${version}`);

  const fragments = collectFragments();

  if (!fragments) {
    console.log('No changelog fragments found');
    process.exit(0);
  }

  updateChangelog('.', version, fragments);
  removeFragments();

  console.log('Changelog collection complete');
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
