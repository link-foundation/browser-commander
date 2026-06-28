#!/usr/bin/env node

/**
 * Check GitHub Actions workflows for CI policy regressions.
 *
 * The repository intentionally keeps this check dependency-free so it can run
 * before package installs and in workflows that do not otherwise need npm.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const WORKFLOW_DIR = '.github/workflows';

const DISALLOWED_PATTERNS = [
  {
    pattern: /\bactions\/checkout@v[1-5]\b/,
    replacement: 'actions/checkout@v6',
  },
  {
    pattern: /\bactions\/setup-node@v[1-5]\b/,
    replacement: 'actions/setup-node@v6',
  },
  {
    pattern: /\bactions\/upload-artifact@v[1-6]\b/,
    replacement: 'actions/upload-artifact@v7',
  },
  {
    pattern: /\bactions\/download-artifact@v[1-6]\b/,
    replacement: 'actions/download-artifact@v7',
  },
  {
    pattern: /\bactions\/upload-pages-artifact@v[1-4]\b/,
    replacement: 'actions/upload-pages-artifact@v5',
  },
  {
    pattern: /\bactions\/deploy-pages@v[1-4]\b/,
    replacement: 'actions/deploy-pages@v5',
  },
  {
    pattern: /\bactions\/configure-pages@v[1-5]\b/,
    replacement: 'actions/configure-pages@v6',
  },
  {
    pattern: /\bactions\/cache@v[1-4]\b/,
    replacement: 'actions/cache@v5',
  },
  {
    pattern: /\bcodecov\/codecov-action@v[1-5]\b/,
    replacement: 'codecov/codecov-action@v6',
  },
  {
    pattern: /node-version:\s*['"]?20\.x['"]?/,
    replacement: "node-version: '24.x'",
  },
];

function report(file, lineNumber, message) {
  console.error(`::error file=${file},line=${lineNumber}::${message}`);
}

function findLineNumber(lines, pattern) {
  const index = lines.findIndex((line) => pattern.test(line));
  return index === -1 ? 1 : index + 1;
}

function checkWorkflow(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let failures = 0;

  for (const { pattern, replacement } of DISALLOWED_PATTERNS) {
    for (const [index, line] of lines.entries()) {
      if (pattern.test(line)) {
        report(
          filePath,
          index + 1,
          `Use ${replacement}; older action/runtime versions reintroduce CI warnings.`
        );
        failures++;
      }
    }
  }

  if (content.includes('actions/deploy-pages@')) {
    if (!content.includes('actions/configure-pages@v6')) {
      report(
        filePath,
        findLineNumber(lines, /actions\/deploy-pages@/),
        'Pages deployments must run actions/configure-pages@v6 before upload/deploy.'
      );
      failures++;
    }

    if (!content.includes("vars.DEPLOY_GITHUB_PAGES == 'true'")) {
      report(
        filePath,
        findLineNumber(lines, /actions\/deploy-pages@/),
        'Pages deployments must be gated by DEPLOY_GITHUB_PAGES to avoid 404 failures when Pages is not configured.'
      );
      failures++;
    }
  }

  return failures;
}

function main() {
  const workflowFiles = readdirSync(WORKFLOW_DIR)
    .filter((fileName) => fileName.endsWith('.yml') || fileName.endsWith('.yaml'))
    .map((fileName) => join(WORKFLOW_DIR, fileName))
    .sort();

  let failures = 0;
  for (const workflowFile of workflowFiles) {
    failures += checkWorkflow(workflowFile);
  }

  if (failures > 0) {
    console.error(`CI workflow policy failed with ${failures} issue(s).`);
    process.exit(1);
  }

  console.log(`CI workflow policy passed for ${workflowFiles.length} workflow(s).`);
}

main();
