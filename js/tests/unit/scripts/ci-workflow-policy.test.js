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

  it('rejects untrusted expressions interpolated into run bodies', () => {
    const workflow = `name: Test
on:
  workflow_dispatch:
    inputs:
      bump_type:
        type: choice
        options:
          - patch
      description:
        type: string
env:
  GIT_CONFIG_KEY_0: init.defaultBranch
jobs:
  release:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    concurrency:
      group: \${{ github.workflow }}-\${{ github.ref }}-release
      cancel-in-progress: true
    steps:
      - uses: actions/checkout@v6
      - run: echo "\${{ github.base_ref }}"
      - run: bump "\${{ github.event.inputs.bump_type }}" "\${{ github.event.inputs.description }}"
      - uses: peter-evans/create-pull-request@v7
        with:
          title: 'release \${{ github.event.inputs.description }}'
`;
    const originalError = console.error;
    console.error = () => {};

    try {
      withWorkflow(workflow, (filePath) => {
        // One github.base_ref interpolation, one free-form input inside a run
        // body (bump_type is a choice input, and the create-pull-request title
        // is an action input rather than a shell body), one outdated action.
        assert.equal(checkWorkflow(filePath), 3);
      });
    } finally {
      console.error = originalError;
    }
  });

  it('rejects a condition that starts with the YAML tag indicator', () => {
    const workflow = `name: Test
on: push
env:
  GIT_CONFIG_KEY_0: init.defaultBranch
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    concurrency:
      group: \${{ github.workflow }}-\${{ github.ref }}-test
      cancel-in-progress: true
    if: !cancelled() && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v6
`;
    const originalError = console.error;
    console.error = () => {};

    try {
      withWorkflow(workflow, (filePath) => {
        assert.equal(checkWorkflow(filePath), 1);
      });
    } finally {
      console.error = originalError;
    }
  });

  it('rejects outdated setup-python and codecov versions', () => {
    const workflow = `name: Test
on: push
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
      - uses: actions/setup-python@v5
      - uses: codecov/codecov-action@v6
`;
    const originalError = console.error;
    console.error = () => {};

    try {
      withWorkflow(workflow, (filePath) => {
        assert.equal(checkWorkflow(filePath), 2);
      });
    } finally {
      console.error = originalError;
    }
  });

  it('accepts a base_ref bound to any environment variable name', () => {
    const workflow = `name: Test
on: pull_request
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
      - name: Simulate fresh merge
        env:
          BASE_REF: \${{ github.base_ref }}
        run: bash scripts/simulate-fresh-merge.sh
`;

    withWorkflow(workflow, (filePath) => {
      assert.equal(checkWorkflow(filePath), 0);
    });
  });

  it('still rejects a base_ref spliced into a run body', () => {
    const workflow = `name: Test
on: pull_request
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
      - run: git fetch origin \${{ github.base_ref }}
`;
    const originalError = console.error;
    console.error = () => {};

    try {
      withWorkflow(workflow, (filePath) => {
        assert.ok(checkWorkflow(filePath) > 0);
      });
    } finally {
      console.error = originalError;
    }
  });
});
