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

// The cheap check every expensive job waits on, and the jobs that must wait.
const FAST_CHECK_JOB = 'lint';
const SLOW_JOB_PATTERN = /^(test|coverage)(-|$)/;

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
 * Read a job's `if:`, in either the folded or the single-line spelling.
 *
 * @param {string[]} block
 * @returns {string}
 */
function readJobCondition(block) {
  const conditionIndex = block.findIndex((line) => /^ {4}if:/.test(line));

  if (conditionIndex === -1) {
    return '';
  }

  const parts = [block[conditionIndex].replace(/^ {4}if:/, '')];

  for (const line of block.slice(conditionIndex + 1)) {
    if (!/^ {6}\S/.test(line)) {
      break;
    }

    parts.push(line);
  }

  return parts.join(' ');
}

/**
 * Fast checks gate slow ones (CI-CD-BEST-PRACTICES, principle 5).
 *
 * `lint` is one runner for well under a minute; the `test` matrix is three
 * operating systems that each install dependencies first. Letting them race
 * means a missing semicolon still buys the whole matrix, on every push, and
 * the contributor waits for the slowest job to learn about the fastest one.
 *
 * The dependency may be transitive - `coverage` waiting on `test` waiting on
 * `lint` is the ordering this rule is after.
 *
 * The second half of the rule is the part that is easy to get wrong. An `if:`
 * containing `always()` or `!cancelled()` overrides GitHub's implicit "all
 * needs succeeded" requirement, so `needs: [lint]` under a bare `!cancelled()`
 * is a dependency the run does not actually enforce - the job graph claims a
 * gate that is not there. Such a condition has to restate the requirement,
 * either as a blanket `!contains(needs.*.result, 'failure')` or as an explicit
 * comparison on the result of the job it waits for.
 *
 * @param {string} filePath
 * @param {string[]} lines
 * @param {number[]} jobStarts
 * @returns {number}
 */
function checkFastFailOrdering(filePath, lines, jobStarts) {
  const jobNames = jobStarts.map((start) => lines[start].trim().slice(0, -1));

  if (!jobNames.includes(FAST_CHECK_JOB)) {
    return 0;
  }

  const blocks = jobStarts.map((start, jobIndex) =>
    lines.slice(start, jobStarts[jobIndex + 1] ?? lines.length)
  );
  const needsByJob = new Map(
    jobNames.map((jobName, jobIndex) => [
      jobName,
      readJobNeeds(blocks[jobIndex]),
    ])
  );

  /**
   * Does `jobName` wait for the fast check, directly or through another job?
   *
   * @param {string} jobName
   * @param {Set<string>} seen
   * @returns {boolean}
   */
  const waitsForFastCheck = (jobName, seen = new Set()) => {
    if (seen.has(jobName)) {
      return false;
    }

    seen.add(jobName);

    return (needsByJob.get(jobName) ?? []).some(
      (dependency) =>
        dependency === FAST_CHECK_JOB || waitsForFastCheck(dependency, seen)
    );
  };

  let failures = 0;

  for (const [jobIndex, start] of jobStarts.entries()) {
    const jobName = jobNames[jobIndex];

    if (!SLOW_JOB_PATTERN.test(jobName)) {
      continue;
    }

    if (!waitsForFastCheck(jobName)) {
      report(
        filePath,
        start + 1,
        `Job ${jobName} must need ${FAST_CHECK_JOB}; a slow matrix should not start until the fast check that would have failed the run has passed.`
      );
      failures++;
      continue;
    }

    const condition = readJobCondition(blocks[jobIndex]);

    if (!/always\(\)|!\s*cancelled\(\)/.test(condition)) {
      continue;
    }

    const gating = (needsByJob.get(jobName) ?? []).filter(
      (dependency) =>
        dependency === FAST_CHECK_JOB || waitsForFastCheck(dependency)
    );
    const restated =
      /!\s*contains\(needs\.\*\.result,\s*'failure'\)/.test(condition) ||
      gating.some((dependency) =>
        new RegExp(`needs\\.${dependency}\\.result\\s*==`).test(condition)
      );

    if (!restated) {
      report(
        filePath,
        start + 1,
        `Job ${jobName} waits for ${gating.join(', ')} but its condition uses always()/!cancelled(), which overrides that dependency. Restate it with !contains(needs.*.result, 'failure') or an explicit needs.<job>.result comparison.`
      );
      failures++;
    }
  }

  return failures;
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

/**
 * Workflow-level concurrency cancels writers along with the checks.
 *
 * @param {string} filePath
 * @param {string[]} lines
 * @param {number} jobsLineIndex
 * @returns {number}
 */
function checkConcurrencyScope(filePath, lines, jobsLineIndex) {
  const preamble = jobsLineIndex === -1 ? lines : lines.slice(0, jobsLineIndex);

  if (!preamble.some((line) => line === 'concurrency:')) {
    return 0;
  }

  report(
    filePath,
    findLineNumber(lines, /^concurrency:$/),
    'Use job-scoped concurrency so superseded checks can be cancelled without interrupting release or deployment writers.'
  );

  return 1;
}

/**
 * actions/checkout warns about the default branch name unless git is told it.
 *
 * @param {string} filePath
 * @param {string[]} lines
 * @param {string} content
 * @returns {number}
 */
function checkDefaultBranchConfig(filePath, lines, content) {
  if (
    !content.includes('actions/checkout@') ||
    content.includes('GIT_CONFIG_KEY_0: init.defaultBranch')
  ) {
    return 0;
  }

  report(
    filePath,
    findLineNumber(lines, /actions\/checkout@/),
    'Set init.defaultBranch=main through workflow env so actions/checkout does not emit default-branch warning noise.'
  );

  return 1;
}

/**
 * The rules that read one line at a time: untrusted refs and YAML tag
 * indicators.
 *
 * @param {string} filePath
 * @param {string[]} lines
 * @returns {number}
 */
function checkLinePolicies(filePath, lines) {
  let failures = 0;

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

    for (const refName of ['head_ref', 'base_ref']) {
      if (line.includes(`\${{ github.${refName} }}`) && !isEnvBinding) {
        report(
          filePath,
          index + 1,
          `Pass github.${refName} through an environment variable instead of interpolating untrusted PR data directly.`
        );
        failures++;
      }
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

  return failures;
}

/**
 * Codecov v7 renamed `file` to `files`, and ignores the old spelling silently.
 *
 * @param {string} filePath
 * @param {string[]} lines
 * @param {string} content
 * @returns {number}
 */
function checkCodecovInputs(filePath, lines, content) {
  if (!content.includes('codecov/codecov-action@v7')) {
    return 0;
  }

  let failures = 0;

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

  return failures;
}

/**
 * The line indexes at which each job under `jobs:` begins.
 *
 * @param {string[]} lines
 * @param {number} jobsLineIndex
 * @returns {number[]}
 */
function findJobStarts(lines, jobsLineIndex) {
  if (jobsLineIndex === -1) {
    return [];
  }

  const jobStarts = [];

  for (let index = jobsLineIndex + 1; index < lines.length; index += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:$/.test(lines[index])) {
      jobStarts.push(index);
    }
  }

  return jobStarts;
}

/**
 * The concurrency rules that apply to a single job block.
 *
 * @param {string} filePath
 * @param {string[]} block
 * @param {string} jobName
 * @param {number} start
 * @returns {number}
 */
function checkJobConcurrency(filePath, block, jobName, start) {
  if (!block.some((line) => /^ {4}concurrency:/.test(line))) {
    report(
      filePath,
      start + 1,
      `Job ${jobName} must use job-scoped concurrency.`
    );

    return 1;
  }

  let failures = 0;
  const blockText = block.join('\n');
  const hasGroup = /^ {6}group:/m.test(blockText);
  const hasCancellationPolicy = /^ {6}cancel-in-progress:/m.test(blockText);

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
    !blockText.includes('group: main-writer-${{ github.repository }}-main')
  ) {
    report(
      filePath,
      start + 1,
      `Non-cancellable writer ${jobName} must use the repository-wide main-writer group.`
    );
    failures++;
  }

  return failures;
}

/**
 * Every job needs a backstop, a concurrency group, and a condition that lets
 * cancellation propagate.
 *
 * @param {string} filePath
 * @param {string[]} lines
 * @param {number[]} jobStarts
 * @returns {number}
 */
function checkJobPolicies(filePath, lines, jobStarts) {
  let failures = 0;

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

    failures += checkJobConcurrency(filePath, block, jobName, start);

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

  return failures;
}

/**
 * Action and runtime versions that reintroduce deprecation warnings.
 *
 * @param {string} filePath
 * @param {string[]} lines
 * @returns {number}
 */
function checkDisallowedVersions(filePath, lines) {
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

  return failures;
}

/**
 * A Pages deployment fails with a 404 unless Pages is configured and enabled.
 *
 * @param {string} filePath
 * @param {string[]} lines
 * @param {string} content
 * @returns {number}
 */
function checkPagesDeployment(filePath, lines, content) {
  if (!content.includes('actions/deploy-pages@')) {
    return 0;
  }

  let failures = 0;

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

  return failures;
}

/**
 * Run every policy rule against one workflow file.
 *
 * Each rule is its own function so adding one stops growing a single
 * function past the limits the repository's own linter enforces.
 *
 * @param {string} filePath
 * @returns {number} the number of policy violations reported
 */
export function checkWorkflow(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const jobsLineIndex = lines.findIndex((line) => line === 'jobs:');
  const jobStarts = findJobStarts(lines, jobsLineIndex);

  const failures = [
    checkConcurrencyScope(filePath, lines, jobsLineIndex),
    checkDefaultBranchConfig(filePath, lines, content),
    checkLinePolicies(filePath, lines),
    checkRunBodyInjection(filePath, lines),
    checkManifestScraping(filePath, lines),
    checkCodecovInputs(filePath, lines, content),
    checkJobPolicies(filePath, lines, jobStarts),
    checkFastFailOrdering(filePath, lines, jobStarts),
    jobsLineIndex === -1
      ? 0
      : checkPipelineStatusGate(filePath, lines, jobStarts, jobsLineIndex),
    checkDisallowedVersions(filePath, lines),
    checkPagesDeployment(filePath, lines, content),
  ];

  return failures.reduce((total, count) => total + count, 0);
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
