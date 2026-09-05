/**
 * `timeout-minutes` is a backstop, never a deadline.
 *
 * GitHub reports a job killed by `timeout-minutes` as *cancelled*, not
 * *failed*, so an overrun used to leave no red check anywhere (see
 * docs/CI-TIMEOUT-BUDGETS.md). Two things fix that: long steps own an explicit
 * budget through scripts/run-with-budget-warning.sh, and every workflow ends in
 * a `pipeline-status` job that reads the results of all the others.
 *
 * These assertions are what find the *next* occurrence instead of the one that
 * already happened: a budget raised above its job's backstop, or a new job that
 * the gate does not watch, fails here rather than in production.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { repoPath } from '../../helpers/repo.js';

const WORKFLOW_DIR = repoPath('.github/workflows');

// A budget must expire with room to spare before the backstop fires, because
// checkout, toolchain installation and dependency installs run on the same job
// clock and are not budgeted. The share matches BUDGET_WARN_PERCENT in
// scripts/run-with-budget-warning.sh.
const MAX_BUDGET_SHARE_PERCENT = 70;

const GATE_JOB = 'pipeline-status';
const GATE_SCRIPT = 'scripts/check-pipeline-status.sh';

function readWorkflow(fileName) {
  return readFileSync(
    repoPath('.github/workflows', fileName),
    'utf8'
  ).replaceAll('\r\n', '\n');
}

function listWorkflowFiles() {
  return readdirSync(WORKFLOW_DIR)
    .filter((fileName) => fileName.endsWith('.yml'))
    .sort();
}

// Only the mapping under `jobs:` is scanned, so the two-space keys of `on:`
// (`push:`, `pull_request:`) are not mistaken for job names.
function listWorkflowJobs(workflow) {
  const jobsStart = workflow.indexOf('\njobs:\n');
  const jobsBody = jobsStart === -1 ? '' : workflow.slice(jobsStart);

  return Array.from(
    jobsBody.matchAll(/^ {2}([a-zA-Z0-9_-]+):\s*$/gm),
    (match) => match[1]
  );
}

function getJobBlock(workflow, jobName) {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${jobName}:`);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-zA-Z0-9_-]+:\s*$/.test(line)
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

function getTimeoutMinutes(workflow, jobName) {
  const timeout = getJobBlock(workflow, jobName).match(
    /^ {4}timeout-minutes:\s*(\d+)\s*$/m
  );

  return timeout ? Number(timeout[1]) : undefined;
}

function getStepBudgets(workflow, jobName) {
  return Array.from(
    getJobBlock(workflow, jobName).matchAll(
      /run-with-budget-warning\.sh\s+(\d+)\s+"([^"]+)"/g
    ),
    (match) => ({ label: match[2], seconds: Number(match[1]) })
  );
}

function getJobNeeds(workflow, jobName) {
  const block = getJobBlock(workflow, jobName);
  const inline = block.match(/^ {4}needs:\s*\[([^\]]*)\]\s*$/m);

  if (inline) {
    return inline[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
  }

  const listStart = block.indexOf('\n    needs:\n');

  if (listStart === -1) {
    return [];
  }

  const lines = block
    .slice(listStart + 1)
    .split('\n')
    .slice(1);
  const needs = [];

  for (const line of lines) {
    const item = line.match(/^ {6}- ([a-zA-Z0-9_-]+)\s*$/);

    if (!item) {
      break;
    }

    needs.push(item[1]);
  }

  return needs;
}

const WORKFLOWS = listWorkflowFiles().map((fileName) => ({
  fileName,
  text: readWorkflow(fileName),
}));

describe('CI execution budgets', () => {
  it('finds the workflows to check', () => {
    assert.ok(
      WORKFLOWS.length >= 9,
      `expected the repository's workflows, found ${WORKFLOWS.length}`
    );
  });

  it('keeps every declared step budget under its job backstop', () => {
    const violations = [];
    let budgetedJobs = 0;

    for (const { fileName, text } of WORKFLOWS) {
      for (const jobName of listWorkflowJobs(text)) {
        const budgets = getStepBudgets(text, jobName);

        if (budgets.length === 0) {
          continue;
        }

        budgetedJobs += 1;

        const backstop = getTimeoutMinutes(text, jobName);

        if (typeof backstop !== 'number') {
          violations.push(`${fileName} ${jobName}: no timeout-minutes`);
          continue;
        }

        const allowedSeconds = Math.floor(
          (backstop * 60 * MAX_BUDGET_SHARE_PERCENT) / 100
        );
        const totalSeconds = budgets.reduce(
          (sum, budget) => sum + budget.seconds,
          0
        );

        for (const budget of budgets) {
          if (budget.seconds > allowedSeconds) {
            violations.push(
              `${fileName} ${jobName}: "${budget.label}" budget ${budget.seconds}s exceeds ${allowedSeconds}s (${MAX_BUDGET_SHARE_PERCENT}% of the ${backstop}min backstop)`
            );
          }
        }

        if (totalSeconds > allowedSeconds) {
          violations.push(
            `${fileName} ${jobName}: budgets total ${totalSeconds}s, exceeding ${allowedSeconds}s (${MAX_BUDGET_SHARE_PERCENT}% of the ${backstop}min backstop)`
          );
        }
      }
    }

    assert.deepEqual(violations, []);
    assert.ok(budgetedJobs > 0, 'no job declares a step budget');
  });

  it('wraps the long steps that used to be able to run past a backstop', () => {
    const budgeted = WORKFLOWS.flatMap(({ fileName, text }) =>
      listWorkflowJobs(text).flatMap((jobName) =>
        getStepBudgets(text, jobName).map(
          (budget) => `${fileName} ${jobName} ${budget.label}`
        )
      )
    ).sort();

    assert.deepEqual(budgeted, [
      'docs.yml build-docs Rust API docs',
      'js.yml test Node.js test suite',
      'parity.yml parity Fingerprint parity suite',
      'python.yml test pytest suite',
      'rust.yml coverage Rust code coverage',
      'rust.yml test Rust doc tests',
      'rust.yml test Rust test suite',
    ]);
  });

  it('warns at the same share of a budget that this invariant allows', () => {
    const wrapper = readFileSync(
      repoPath('scripts/run-with-budget-warning.sh'),
      'utf8'
    );

    assert.match(
      wrapper,
      new RegExp(`BUDGET_WARN_PERCENT:-${MAX_BUDGET_SHARE_PERCENT}`)
    );
  });

  it('runs the wrapper under bash, not the Windows default shell', () => {
    for (const { fileName, text } of WORKFLOWS) {
      const lines = text.split('\n');

      lines.forEach((line, index) => {
        if (!line.includes('run-with-budget-warning.sh')) {
          return;
        }

        const step = lines
          .slice(Math.max(0, index - 12), index + 1)
          .join('\n')
          .split(/^ {6}- /m)
          .pop();

        assert.ok(
          /shell: bash/.test(step),
          `${fileName}:${index + 1} wraps a command without "shell: bash"; the default shell on windows-latest is pwsh`
        );
      });
    }
  });
});

describe('pipeline status gate', () => {
  it('is present in every workflow and needs every other job', () => {
    for (const { fileName, text } of WORKFLOWS) {
      const jobs = listWorkflowJobs(text);

      assert.ok(
        jobs.includes(GATE_JOB),
        `${fileName} has no ${GATE_JOB} job, so a cancelled job there would go unreported`
      );

      const watched = getJobNeeds(text, GATE_JOB).sort();
      const expected = jobs.filter((jobName) => jobName !== GATE_JOB).sort();

      assert.deepEqual(
        watched,
        expected,
        `${fileName}: ${GATE_JOB} does not watch every job`
      );
    }
  });

  it('runs the gate script after a failed dependency', () => {
    for (const { fileName, text } of WORKFLOWS) {
      const block = getJobBlock(text, GATE_JOB);

      assert.ok(
        block.includes(`run: bash ${GATE_SCRIPT}`),
        `${fileName}: ${GATE_JOB} does not run ${GATE_SCRIPT}`
      );

      // Without a status function the gate inherits "every dependency
      // succeeded" and is skipped in exactly the runs it exists to report.
      assert.match(
        block,
        /if: >-\n\s*!cancelled\(\)/,
        `${fileName}: ${GATE_JOB} must be conditioned on !cancelled()`
      );

      assert.match(
        block,
        /NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/,
        `${fileName}: ${GATE_JOB} does not pass the job results to the script`
      );

      assert.match(
        block,
        /RUN_SHA: \$\{\{ github\.sha \}\}/,
        `${fileName}: ${GATE_JOB} cannot tell a supersede from an overrun without RUN_SHA`
      );
    }
  });

  it('reads the gate script from the repository root in scoped workflows', () => {
    // js.yml, python.yml and rust.yml set defaults.run.working-directory to the
    // language subdirectory, where scripts/check-pipeline-status.sh does not
    // exist.
    for (const { fileName, text } of WORKFLOWS) {
      if (!/^defaults:\n {2}run:\n {4}working-directory: \S+$/m.test(text)) {
        continue;
      }

      assert.match(
        getJobBlock(text, GATE_JOB),
        /working-directory: \.$/m,
        `${fileName}: ${GATE_JOB} runs in the language subdirectory, where ${GATE_SCRIPT} is not`
      );
    }
  });
});
