#!/usr/bin/env node

/**
 * Test script to verify the findNextAvailableVersion logic
 */

async function checkVersionOnCratesIo(crateName, version) {
  try {
    const response = await fetch(
      `https://crates.io/api/v1/crates/${crateName}/${version}`,
      {
        headers: {
          'User-Agent': 'browser-commander-test (github.com/link-foundation/browser-commander)',
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

function calculateNewVersion(current, bumpType) {
  const { major, minor, patch } = current;
  switch (bumpType) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: throw new Error(`Invalid bump type: ${bumpType}`);
  }
}

async function findNextAvailableVersion(crateName, current, bumpType) {
  let version = calculateNewVersion(current, bumpType);

  while (await checkVersionOnCratesIo(crateName, version)) {
    console.log(`  Version ${version} already published on crates.io, trying next...`);
    const parts = version.split('.').map(Number);
    const next = { major: parts[0], minor: parts[1], patch: parts[2] };
    version = calculateNewVersion(next, 'patch');
  }

  return version;
}

async function main() {
  console.log('Testing findNextAvailableVersion...\n');

  // Test 1: Starting from 0.4.0 (which IS published), patch bump should find 0.4.1
  console.log('Test 1: From 0.4.0, patch bump (0.4.0 is published, 0.4.1 is not)');
  const v1 = await findNextAvailableVersion('browser-commander', { major: 0, minor: 4, patch: 0 }, 'patch');
  console.log(`  Result: ${v1}`);
  console.log(`  ${v1 === '0.4.1' ? 'PASS' : 'FAIL'}: expected 0.4.1\n`);

  // Test 2: Starting from 0.8.0 (NOT published), minor bump should find 0.9.0
  console.log('Test 2: From 0.8.0, minor bump (0.9.0 is not published)');
  const v2 = await findNextAvailableVersion('browser-commander', { major: 0, minor: 8, patch: 0 }, 'minor');
  console.log(`  Result: ${v2}`);
  console.log(`  ${v2 === '0.9.0' ? 'PASS' : 'FAIL'}: expected 0.9.0\n`);

  // Test 3: serde has many versions, patch from 1.0.0 should skip past published ones
  console.log('Test 3: serde from 1.0.0, patch bump (many versions published)');
  const v3 = await findNextAvailableVersion('serde', { major: 1, minor: 0, patch: 0 }, 'patch');
  console.log(`  Result: ${v3}`);
  const v3Parts = v3.split('.').map(Number);
  console.log(`  ${v3Parts[2] > 1 ? 'PASS' : 'FAIL'}: should skip past published versions\n`);

  console.log('All tests completed.');
}

main();
