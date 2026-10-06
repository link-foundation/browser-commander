/**
 * Every zizmor in ci-policy.yml must be the same zizmor (issue #128).
 *
 * The zizmor job runs the analyser twice: once through zizmor-action, once
 * through `pipx run zizmor==X` for the pedantic-only image audit. A comment
 * documents the `pipx` command that reproduces the job. When those three name
 * different versions, a finding seen in CI cannot be reproduced with the
 * documented command, and the two passes disagree on what the audits are —
 * the JS pipeline template ships exactly that split (action 1.29.0, pedantic
 * pass 1.30.0).
 *
 * The action also refuses a version absent from its own digest table
 * ("Unknown version"), so the action tag is recorded next to the newest
 * version it knows: bumping `version:` without bumping the action fails here
 * instead of on the pull request.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { repoPath } from '../../helpers/repo.js';

// support/versions of each zizmor-action release, newest entry only.
const ACTION_NEWEST_ZIZMOR = {
  'v0.6.2': '1.29.0',
  'v0.6.3': '1.30.0',
  'v0.6.4': '1.30.1',
};

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
}

const workflow = readFileSync(
  repoPath('.github/workflows/ci-policy.yml'),
  'utf8'
).replaceAll('\r\n', '\n');

describe('zizmor version in ci-policy.yml', () => {
  const actionTag = workflow.match(/zizmorcore\/zizmor-action@(v[\d.]+)/)?.[1];
  const actionVersion = workflow.match(
    /zizmor-action@[^\n]+\n(?: {8}.*\n)*? {10}version: ([\d.]+)/
  )?.[1];
  const pipxVersions = [...workflow.matchAll(/zizmor==([\d.]+)/g)].map(
    (m) => m[1]
  );

  it('names an explicit zizmor version for the action', () => {
    assert.ok(actionTag, 'zizmor-action step not found');
    assert.ok(actionVersion, 'zizmor-action step has no `version:` input');
  });

  it('uses one zizmor version in the action, the pipx pass and the reproduce comment', () => {
    assert.ok(
      pipxVersions.length >= 2,
      'expected the pedantic pass and the reproduce comment'
    );
    for (const version of pipxVersions) {
      assert.equal(version, actionVersion);
    }
  });

  it('asks the action only for a version its digest table contains', () => {
    const newest = ACTION_NEWEST_ZIZMOR[actionTag];
    assert.ok(
      newest,
      `record the newest zizmor in ${actionTag}'s support/versions here`
    );
    assert.ok(
      compareVersions(actionVersion, newest) <= 0,
      `zizmor-action ${actionTag} cannot install zizmor ${actionVersion}`
    );
  });
});
