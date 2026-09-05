import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkWorkflow } from '../../../../scripts/check-ci-workflows.mjs';

function withWorkflow(content, callback) {
  const directory = mkdtempSync(join(tmpdir(), 'browser-commander-ci-'));
  const filePath = join(directory, 'workflow.yml');
  writeFileSync(filePath, content);

  try {
    return callback(filePath);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

/**
 * Build a workflow that already satisfies every unrelated policy rule.
 *
 * Each test then varies exactly one thing, so a failure count of N names the N
 * rules under test instead of the scaffolding around them.
 *
 * @param {{on?: string, preamble?: string, job?: string, steps: string}} parts
 * @returns {string}
 */
function workflow({ on = 'push', preamble = '', job = 'test', steps }) {
  return [
    'name: Test',
    `on: ${on}`,
    preamble,
    'env:',
    '  GIT_CONFIG_KEY_0: init.defaultBranch',
    'jobs:',
    `  ${job}:`,
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 5',
    '    concurrency:',
    `      group: \${{ github.workflow }}-\${{ github.ref }}-${job}`,
    '      cancel-in-progress: true',
    '    steps:',
    '      - uses: actions/checkout@v6',
    steps,
    // Every workflow has to end in the gate that reads the other jobs'
    // results, so the scaffolding carries one; the gate's own tests are in
    // ci-timeout-budgets.test.js.
    '  pipeline-status:',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 5',
    '    concurrency:',
    '      group: ${{ github.workflow }}-${{ github.ref }}-pipeline-status',
    '      cancel-in-progress: true',
    `    needs: [${job}]`,
    '    steps:',
    '      - run: bash scripts/check-pipeline-status.sh',
    '',
  ]
    .filter((section) => section !== '')
    .join('\n');
}

/**
 * Count policy failures without letting the reported ::error:: lines leak into
 * the test output, where they read like real CI annotations.
 *
 * @param {string} content
 * @returns {number}
 */
function countFailures(content) {
  const originalError = console.error;
  console.error = () => {};

  try {
    return withWorkflow(content, checkWorkflow);
  } finally {
    console.error = originalError;
  }
}

describe('CI workflow policy', () => {
  it('accepts bounded job-scoped checks', () => {
    const content = workflow({
      preamble: 'permissions:\n  contents: read',
      steps: '      - run: npm ci --ignore-scripts',
    });

    withWorkflow(content, (filePath) => {
      assert.equal(checkWorkflow(filePath), 0);
    });
  });

  it('rejects workflow-wide cancellation and unbounded jobs', () => {
    const content = `name: Test
on: push
concurrency:
  group: test
  cancel-in-progress: true
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: npm install
      - run: echo "\${{ github.head_ref }}"
      - uses: codecov/codecov-action@v6
        with:
          file: coverage.xml
`;

    // The eighth is the missing pipeline-status gate: with no job reading the
    // other jobs' results, a check killed by timeout-minutes is reported as
    // cancelled and fails nothing.
    assert.equal(countFailures(content), 8);
  });

  it('rejects untrusted expressions interpolated into run bodies', () => {
    const content = workflow({
      on: '\n  workflow_dispatch:\n    inputs:\n      bump_type:\n        type: choice\n        options:\n          - patch\n      description:\n        type: string',
      job: 'release',
      steps: [
        '      - run: echo "${{ github.base_ref }}"',
        '      - run: bump "${{ github.event.inputs.bump_type }}" "${{ github.event.inputs.description }}"',
        '      - uses: peter-evans/create-pull-request@v7',
        '        with:',
        "          title: 'release ${{ github.event.inputs.description }}'",
      ].join('\n'),
    });

    // One github.base_ref interpolation, one free-form input inside a run body
    // (bump_type is a choice input, and the create-pull-request title is an
    // action input rather than a shell body), one outdated action.
    assert.equal(countFailures(content), 3);
  });

  it('rejects a condition that starts with the YAML tag indicator', () => {
    const content = workflow({
      steps:
        "      - run: echo ok\n    if: !cancelled() && github.event_name == 'push'",
    });

    assert.equal(countFailures(content), 1);
  });

  it('rejects outdated setup-python and codecov versions', () => {
    const content = workflow({
      steps: [
        '      - uses: actions/setup-python@v5',
        '      - uses: codecov/codecov-action@v6',
      ].join('\n'),
    });

    assert.equal(countFailures(content), 2);
  });

  it('accepts a base_ref bound to any environment variable name', () => {
    const content = workflow({
      on: 'pull_request',
      steps: [
        '      - name: Simulate fresh merge',
        '        env:',
        '          BASE_REF: ${{ github.base_ref }}',
        '        run: bash scripts/simulate-fresh-merge.sh',
      ].join('\n'),
    });

    withWorkflow(content, (filePath) => {
      assert.equal(checkWorkflow(filePath), 0);
    });
  });

  it('still rejects a base_ref spliced into a run body', () => {
    const content = workflow({
      on: 'pull_request',
      steps: '      - run: git fetch origin ${{ github.base_ref }}',
    });

    assert.ok(countFailures(content) > 0);
  });

  it('rejects a version scraped out of pyproject.toml with grep', () => {
    // The exact command that shipped in python.yml until this pull request.
    // pyproject.toml carries `version` under [project] and under [tool.scriv],
    // so this grep wrote two lines into $GITHUB_OUTPUT and failed the step.
    const content = workflow({
      steps: [
        '      - run: |',
        `          CURRENT_VERSION=$(grep -Po '(?<=^version = ")[^"]*' pyproject.toml)`,
        '          echo "current_version=$CURRENT_VERSION" >> $GITHUB_OUTPUT',
      ].join('\n'),
    });

    assert.equal(countFailures(content), 1);
  });

  it('rejects a crate name scraped out of Cargo.toml with head -1', () => {
    // `head -1` is ordering-dependent, not table-aware: Cargo.toml repeats
    // `name` under [[bin]] and [lib].
    const content = workflow({
      steps: `      - run: grep '^name' Cargo.toml | head -1 | cut -d'"' -f2`,
    });

    assert.equal(countFailures(content), 1);
  });

  it('rejects a workflow with no pipeline-status gate', () => {
    // A job killed by timeout-minutes is reported as cancelled, and a run whose
    // only casualty is a cancelled job is filed under cancelled too, so without
    // this gate the overrun fails nothing.
    const content = workflow({
      steps: '      - run: npm ci --ignore-scripts',
    }).replace(/ {2}pipeline-status:[\s\S]*$/, '');

    assert.equal(countFailures(content), 1);
  });

  it('rejects a gate that has stopped watching a job', () => {
    const content = `${workflow({
      steps: '      - run: npm ci --ignore-scripts',
    })}
  drifted:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    concurrency:
      group: \${{ github.workflow }}-\${{ github.ref }}-drifted
      cancel-in-progress: true
    steps:
      - run: echo drifted
`;

    assert.equal(countFailures(content), 1);
  });

  it('accepts the table-aware manifest readers', () => {
    const content = workflow({
      steps: [
        '      - run: python scripts/read_manifest.py pyproject.toml --output current_version',
        '      - run: node ../scripts/read-manifest.mjs Cargo.toml --field name',
      ].join('\n'),
    });

    withWorkflow(content, (filePath) => {
      assert.equal(checkWorkflow(filePath), 0);
    });
  });

  it('leaves a commented-out manifest grep alone', () => {
    const content = workflow({
      steps: [
        '      - run: |',
        `          # Replaced grep -Po '(?<=^version = ")[^"]*' pyproject.toml`,
        '          python scripts/read_manifest.py pyproject.toml --output version',
      ].join('\n'),
    });

    withWorkflow(content, (filePath) => {
      assert.equal(checkWorkflow(filePath), 0);
    });
  });
});
