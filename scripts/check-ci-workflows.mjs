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

// The job that reads every other job's result; see docs/CI-TIMEOUT-BUDGETS.md.
const PIPELINE_STATUS_JOB = 'pipeline-status';

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
    pattern: /\bactions\/setup-python@v[1-5]\b/,
    replacement: 'actions/setup-python@v6',
  },
  {
    pattern: /\bpeter-evans\/create-pull-request@v[1-7]\b/,
    replacement: 'peter-evans/create-pull-request@v8',
  },
  {
    pattern: /\bcodecov\/codecov-action@v[1-6]\b/,
    replacement: 'codecov/codecov-action@v7',
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

/**
 * Collect the names of workflow_dispatch inputs declared as `type: choice`.
 *
 * GitHub constrains a choice input to its declared options, so interpolating one
 * into a shell body cannot smuggle arbitrary script. Free-form inputs (string,
 * boolean rendered as text, or an input with no declared type) are attacker
 * controlled for anyone who can trigger the workflow and must go through env.
 */
function collectChoiceInputs(lines) {
  const choiceInputs = new Set();
  const inputsIndex = lines.findIndex((line) => /^(\s+)inputs:\s*$/.test(line));
  if (inputsIndex === -1) {
    return choiceInputs;
  }

  const inputsIndent = lines[inputsIndex].search(/\S/);
  const nameIndent = inputsIndent + 2;
  let currentInput = null;

  for (const line of lines.slice(inputsIndex + 1)) {
    if (line.trim() === '') {
      continue;
    }
    const indent = line.search(/\S/);
    if (indent <= inputsIndent) {
      break;
    }

    const declaration = /^\s*([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (indent === nameIndent && declaration) {
      currentInput = declaration[1];
      continue;
    }

    if (currentInput && /^\s*type:\s*choice\s*$/.test(line)) {
      choiceInputs.add(currentInput);
    }
  }

  return choiceInputs;
}

/**
 * Flag untrusted expressions interpolated straight into `run:` shell bodies.
 *
 * Only shell bodies matter here: the same expression inside an action `with:`
 * input is passed as data, not evaluated by bash.
 */
function checkRunBodyInjection(filePath, lines) {
  const choiceInputs = collectChoiceInputs(lines);
  let failures = 0;
  let runIndent = null;

  for (const [index, line] of lines.entries()) {
    const runStart = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (runStart) {
      runIndent = runStart[1].length;
    } else if (runIndent !== null) {
      const indent = line.length - line.trimStart().length;
      if (line.trim() !== '' && indent <= runIndent) {
        runIndent = null;
      }
    }

    if (runIndent === null) {
      continue;
    }

    for (const match of line.matchAll(
      /\$\{\{\s*github\.event\.inputs\.([A-Za-z0-9_-]+)/g
    )) {
      if (choiceInputs.has(match[1])) {
        continue;
      }
      report(
        filePath,
        index + 1,
        `Pass github.event.inputs.${match[1]} through an environment variable; a free-form workflow input is attacker-controlled inside a run body.`
      );
      failures++;
    }
  }

  return failures;
}

/**
 * Flag manifest fields scraped out of TOML with line-oriented text tools.
 *
 * `grep -Po '(?<=^version = ")[^"]*' pyproject.toml` is anchored to the line but
 * blind to the table it sits in. pyproject.toml declares `version` under both
 * [project] and [tool.scriv], and Cargo.toml repeats `name` under [[bin]] and
 * [lib], so the same command emits one line per table. Two lines piped into
 * $GITHUB_OUTPUT fail the step with "Unable to process file command 'output'
 * successfully", which is what broke every Python release from 2026-08-02 on.
 * `head -1` only hides the ambiguity behind table ordering, so the policy asks
 * for the table-aware readers instead.
 */
function checkManifestScraping(filePath, lines) {
  let failures = 0;
  let runIndent = null;

  for (const [index, line] of lines.entries()) {
    const runStart = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (runStart) {
      runIndent = runStart[1].length;
    } else if (runIndent !== null) {
      const indent = line.length - line.trimStart().length;
      if (line.trim() !== '' && indent <= runIndent) {
        runIndent = null;
      }
    }

    if (runIndent === null) {
      continue;
    }
    if (line.trimStart().startsWith('#')) {
      continue;
    }

    const manifest = /\b(pyproject\.toml|Cargo\.toml)\b/.exec(line);
    if (!manifest) {
      continue;
    }
    if (!/\b(grep|sed|awk|cut)\b/.test(line)) {
      continue;
    }
    if (!/\b(version|name)\b/.test(line)) {
      continue;
    }

    report(
      filePath,
      index + 1,
      `Read ${manifest[1]} with scripts/read-manifest.mjs or python/scripts/read_manifest.py; a line-oriented grep/sed/awk is blind to the TOML table and matches every duplicate key.`
    );
    failures++;
  }

  return failures;
}

/**
 * Read a job's `needs:`, in either the inline or the list spelling.
 *
 * @param {string[]} block
 * @returns {string[]}
 */
function readJobNeeds(block) {
  const needsIndex = block.findIndex((line) => /^ {4}needs:/.test(line));

  if (needsIndex === -1) {
    return [];
  }

  const inline = /^ {4}needs:\s*\[([^\]]*)\]\s*$/.exec(block[needsIndex]);

  if (inline) {
    return inline[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
  }

  const needs = [];

  for (const line of block.slice(needsIndex + 1)) {
    const item = /^ {6}- ([A-Za-z0-9_-]+)\s*$/.exec(line);

    if (!item) {
      break;
    }

    needs.push(item[1]);
  }

  return needs;
}

/**
 * Require the gate that turns a cancelled job into a visible failure.
 *
 * GitHub reports a job killed by its `timeout-minutes` as *cancelled*, not
 * *failed*, and a run whose only casualty is a cancelled job carries the
 * conclusion `cancelled` as well - so without a job that reads the results of
 * all the others, an overrun leaves no red check anywhere. The second half of
 * the rule is the one that catches drift: a gate that has stopped watching a
 * job is worth no more than no gate at all.
 *
 * @param {string} filePath
 * @param {string[]} lines
 * @param {number[]} jobStarts
 * @param {number} jobsLineIndex
 * @returns {number}
 */
function checkPipelineStatusGate(filePath, lines, jobStarts, jobsLineIndex) {
  let failures = 0;
  const jobNames = jobStarts.map((start) => lines[start].trim().slice(0, -1));
  const gateIndex = jobNames.indexOf(PIPELINE_STATUS_JOB);

  if (gateIndex === -1) {
    report(
      filePath,
      jobsLineIndex + 1,
      `Add a ${PIPELINE_STATUS_JOB} job that needs every other job; a job killed by timeout-minutes is reported as cancelled rather than failed, so nothing else fails the run.`
    );
    return failures + 1;
  }

  const start = jobStarts[gateIndex];
  const end = jobStarts[gateIndex + 1] ?? lines.length;
  const watched = new Set(readJobNeeds(lines.slice(start, end)));
  const unwatched = jobNames.filter(
    (jobName) => jobName !== PIPELINE_STATUS_JOB && !watched.has(jobName)
  );

  if (unwatched.length > 0) {
    report(
      filePath,
      start + 1,
      `Job ${PIPELINE_STATUS_JOB} does not need ${unwatched.join(', ')}; a job the gate does not watch can be cancelled without failing the run.`
    );
    failures++;
  }

  return failures;
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
    // An attacker-influenced ref is safe once it is bound to an environment
    // variable, because the shell then receives it as data instead of as text
    // spliced into the script. Any SCREAMING_SNAKE_CASE name qualifies: the
    // name itself carries no security meaning, so pinning the rule to one
    // spelling would reject equally safe bindings such as `BASE_REF:`.
    const isEnvBinding =
      /^\s*[A-Z][A-Z0-9_]*:\s*\$\{\{\s*github\.(head|base)_ref\s*\}\}\s*$/.test(
        line
      );

    if (line.includes('${{ github.head_ref }}') && !isEnvBinding) {
      report(
        filePath,
        index + 1,
        'Pass github.head_ref through an environment variable instead of interpolating untrusted PR data directly.'
      );
      failures++;
    }

    if (line.includes('${{ github.base_ref }}') && !isEnvBinding) {
      report(
        filePath,
        index + 1,
        'Pass github.base_ref through an environment variable instead of interpolating untrusted PR data directly.'
      );
      failures++;
    }

    // A YAML plain scalar may not start with "!", which is the tag indicator.
    // `if: !cancelled() && ...` therefore makes the whole workflow unparseable.
    if (/^\s*if:\s*!/.test(line)) {
      report(
        filePath,
        index + 1,
        'A condition starting with ! must use a block scalar (if: >-) or quotes; a plain YAML scalar cannot begin with the tag indicator.'
      );
      failures++;
    }
  }

  failures += checkRunBodyInjection(filePath, lines);
  failures += checkManifestScraping(filePath, lines);

  if (content.includes('codecov/codecov-action@v7')) {
    for (const [index, line] of lines.entries()) {
      if (/^\s+file:/.test(line)) {
        report(
          filePath,
          index + 1,
          'Codecov v7 uses the files input; the singular file input is unsupported.'
        );
        failures++;
      }
    }
  }

  if (jobsLineIndex !== -1) {
    const jobStarts = [];

    for (let index = jobsLineIndex + 1; index < lines.length; index += 1) {
      if (/^ {2}[A-Za-z0-9_-]+:$/.test(lines[index])) {
        jobStarts.push(index);
      }
    }

    for (const [jobIndex, start] of jobStarts.entries()) {
      const end = jobStarts[jobIndex + 1] ?? lines.length;
      const block = lines.slice(start, end);
      const jobName = lines[start].trim().slice(0, -1);

      if (!block.some((line) => /^ {4}timeout-minutes:/.test(line))) {
        report(
          filePath,
          start + 1,
          `Job ${jobName} must set timeout-minutes so stalled checks and writers terminate predictably.`
        );
        failures++;
      }

      if (!block.some((line) => /^ {4}concurrency:/.test(line))) {
        report(
          filePath,
          start + 1,
          `Job ${jobName} must use job-scoped concurrency.`
        );
        failures++;
      } else {
        const blockText = block.join('\n');
        const hasGroup = /^ {6}group:/m.test(blockText);
        const hasCancellationPolicy = /^ {6}cancel-in-progress:/m.test(
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

    failures += checkPipelineStatusGate(
      filePath,
      lines,
      jobStarts,
      jobsLineIndex
    );
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
