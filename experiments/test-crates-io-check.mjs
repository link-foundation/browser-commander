#!/usr/bin/env node

/**
 * Test script to verify the crates.io version check logic
 * used by version-and-commit.mjs
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

async function main() {
  console.log('Testing crates.io version check...\n');

  const tests = [
    // Should be true - published version
    { crate: 'browser-commander', version: '0.4.0', expected: true },
    // Should be false - never published
    { crate: 'browser-commander', version: '0.5.0', expected: false },
    { crate: 'browser-commander', version: '0.8.0', expected: false },
    { crate: 'browser-commander', version: '0.9.0', expected: false },
    // Should be false - non-existent crate
    { crate: 'nonexistent-crate-xyz-123', version: '1.0.0', expected: false },
    // Known popular crate for sanity check
    { crate: 'serde', version: '1.0.0', expected: true },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await checkVersionOnCratesIo(test.crate, test.version);
    const status = result === test.expected ? 'PASS' : 'FAIL';

    if (status === 'PASS') passed++;
    else failed++;

    console.log(
      `${status}: ${test.crate}@${test.version} - expected=${test.expected}, got=${result}`
    );
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${tests.length} tests`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
