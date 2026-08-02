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

describe('CI workflow policy', () => {
  it('accepts bounded job-scoped checks', () => {
    const workflow = `name: Test
on: push
permissions:
  contents: read
env:
  GIT_CONFIG_KEY_0: init.defaultBranch
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    concurrency:
      group: \${{ github.workflow }}-\${{ github.ref }}-test
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@v6
`;

    withWorkflow(workflow, (filePath) => {
      assert.equal(checkWorkflow(filePath), 0);
    });
  });

  it('rejects workflow-wide cancellation and unbounded jobs', () => {
    const workflow = `name: Test
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
    const originalError = console.error;
    console.error = () => {};

    try {
      withWorkflow(workflow, (filePath) => {
        assert.equal(checkWorkflow(filePath), 7);
      });
    } finally {
      console.error = originalError;
    }
  });
});
