#!/usr/bin/env node

/**
 * Check GitHub Actions workflows for CI policy regressions.
 *
 * The repository intentionally keeps this check dependency-free so it can run
 * before package installs and in workflows that do not otherwise need npm.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

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
  {
    pattern: /^\s*-?\s*run:\s*npm install\s*$/,
    replacement:
      'npm ci --ignore-scripts for deterministic dependency-only workflow installs',
  },
];

function report(file, lineNumber, message) {
  console.error(`::error file=${file},line=${lineNumber}::${message}`);
}

function findLineNumber(lines, pattern) {
  const index = lines.findIndex((line) => pattern.test(line));
  return index === -1 ? 1 : index + 1;
}

export function checkWorkflow(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let failures = 0;

  const jobsLineIndex = lines.findIndex((line) => line === 'jobs:');
  const workflowPreamble =
    jobsLineIndex === -1 ? lines : lines.slice(0, jobsLineIndex);

  if (workflowPreamble.some((line) => line === 'concurrency:')) {
    report(
      filePath,
      findLineNumber(lines, /^concurrency:$/),
      'Use job-scoped concurrency so superseded checks can be cancelled without interrupting release or deployment writers.'
    );
    failures++;
  }

  if (
    content.includes('actions/checkout@') &&
    !content.includes('GIT_CONFIG_KEY_0: init.defaultBranch')
  ) {
    report(
      filePath,
      findLineNumber(lines, /actions\/checkout@/),
      'Set init.defaultBranch=main through workflow env so actions/checkout does not emit default-branch warning noise.'
    );
    failures++;
  }

  for (const [index, line] of lines.entries()) {
    if (
      line.includes('${{ github.head_ref }}') &&
      !/^\s*GITHUB_HEAD_REF:/.test(line)
    ) {
      report(
        filePath,
        index + 1,
        'Pass github.head_ref through an environment variable instead of interpolating untrusted PR data directly.'
      );
      failures++;
    }
  }

  if (content.includes('codecov/codecov-action@v6')) {
    for (const [index, line] of lines.entries()) {
      if (/^\s+file:/.test(line)) {
        report(
          filePath,
          index + 1,
          'Codecov v6 uses the files input; the singular file input is unsupported.'
        );
        failures++;
      }
    }
  }

  if (jobsLineIndex !== -1) {
    const jobStarts = [];

    for (let index = jobsLineIndex + 1; index < lines.length; index += 1) {
      if (/^  [A-Za-z0-9_-]+:$/.test(lines[index])) {
        jobStarts.push(index);
      }
    }

    for (const [jobIndex, start] of jobStarts.entries()) {
      const end = jobStarts[jobIndex + 1] ?? lines.length;
      const block = lines.slice(start, end);
      const jobName = lines[start].trim().slice(0, -1);

      if (!block.some((line) => /^    timeout-minutes:/.test(line))) {
        report(
          filePath,
          start + 1,
          `Job ${jobName} must set timeout-minutes so stalled checks and writers terminate predictably.`
        );
        failures++;
      }

      if (!block.some((line) => /^    concurrency:/.test(line))) {
        report(
          filePath,
          start + 1,
          `Job ${jobName} must use job-scoped concurrency.`
        );
        failures++;
      } else {
        const blockText = block.join('\n');
        const hasGroup = /^      group:/m.test(blockText);
        const hasCancellationPolicy = /^      cancel-in-progress:/m.test(
          blockText
        );

        if (!hasGroup || !hasCancellationPolicy) {
          report(
            filePath,
            start + 1,
            `Job ${jobName} concurrency must define both group and cancel-in-progress.`
          );
          failures++;
        }

        if (
          blockText.includes('cancel-in-progress: false') &&
          !blockText.includes(
            'group: main-writer-${{ github.repository }}-main'
          )
        ) {
          report(
            filePath,
            start + 1,
            `Non-cancellable writer ${jobName} must use the repository-wide main-writer group.`
          );
          failures++;
        }
      }

      const executableBlockText = block
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      if (
        executableBlockText.includes('always()') &&
        !executableBlockText.includes('!cancelled()')
      ) {
        report(
          filePath,
          start + 1,
          `Job ${jobName} uses always() without !cancelled(), so downstream work can continue after cancellation.`
        );
        failures++;
      }
    }
  }

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

export function main() {
  const workflowFiles = readdirSync(WORKFLOW_DIR)
    .filter(
      (fileName) => fileName.endsWith('.yml') || fileName.endsWith('.yaml')
    )
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

  console.log(
    `CI workflow policy passed for ${workflowFiles.length} workflow(s).`
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
