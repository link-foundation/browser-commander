/**
 * Guard for RC-1: a release job that treats every rejected push the same.
 *
 * Two rejections both print "rejected" and need opposite responses. A lost
 * race is fixed by rebasing; a repository-rule violation can never be, and
 * retrying it burns the retry and blames a race that never happened.
 *
 * The samples below are the literal wordings the two situations produce:
 * `non-fast-forward` from the CI logs in dev/log/issues/85/pulls/86/ci-logs/,
 * `fetch first` from the local reproduction in
 * experiments/ci-repro/repro-release-push-race.sh.
 *
 * Analysis: dev/log/issues/85/pulls/86/analysis/root-causes.md, RC-1
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NON_FAST_FORWARD_PATTERNS,
  REPOSITORY_RULE_PATTERNS,
  classifyPushFailure,
  isBlockedByRepositoryRule,
  isNonFastForward,
} from '../../../../scripts/push-failure-classifier.mjs';

/** Rejection text a lost race produces, verbatim. */
const RACE_SAMPLES = [
  {
    label: 'non-fast-forward (remote commits already fetched)',
    stderr: [
      'To https://github.com/link-foundation/browser-commander',
      ' ! [rejected]        HEAD -> main (non-fast-forward)',
      "error: failed to push some refs to 'https://github.com/link-foundation/browser-commander'",
      'hint: Updates were rejected because a pushed branch tip is behind its remote',
    ].join('\n'),
  },
  {
    label: 'fetch first (remote commits not yet fetched)',
    stderr: [
      ' ! [rejected]        HEAD -> main (fetch first)',
      'error: failed to push some refs',
      'hint: Updates were rejected because the remote contains work that you do not',
      'hint: have locally.',
    ].join('\n'),
  },
];

/** Rejection text a ruleset or protected branch produces, verbatim. */
const RULE_SAMPLES = [
  {
    label: 'GH013 repository ruleset',
    stderr: [
      'remote: error: GH013: Repository rule violations found for refs/heads/main.',
      'remote: - Changes must be made through a pull request.',
      ' ! [remote rejected] main -> main (push declined due to repository rule violations)',
    ].join('\n'),
  },
  {
    label: 'GH006 legacy protected branch',
    stderr: [
      'remote: error: GH006: Protected branch update failed for refs/heads/main.',
      ' ! [remote rejected] main -> main (protected branch hook declined)',
    ].join('\n'),
  },
];

describe('push failure classifier', () => {
  it('reads a lost race as non-fast-forward', () => {
    for (const sample of RACE_SAMPLES) {
      assert.equal(
        classifyPushFailure(sample),
        'non-fast-forward',
        `${sample.label} must be retried by rebasing`
      );
      assert.equal(isNonFastForward(sample), true, sample.label);
      assert.equal(isBlockedByRepositoryRule(sample), false, sample.label);
    }
  });

  it('never reads a rule violation as a lost race', () => {
    // This is the whole point of the module. A ruleset rejection contains the
    // word "rejected" too, so a naive substring check retries a push that can
    // never succeed.
    for (const sample of RULE_SAMPLES) {
      assert.equal(
        classifyPushFailure(sample),
        'repository-rule',
        `${sample.label} must not be retried`
      );
      assert.equal(isNonFastForward(sample), false, sample.label);
      assert.equal(isBlockedByRepositoryRule(sample), true, sample.label);
    }
  });

  it('leaves an unrelated failure unclassified so it is not retried', () => {
    const authFailure = {
      stderr:
        'fatal: could not read Username for https://github.com: No such device or address',
    };
    assert.equal(classifyPushFailure(authFailure), 'unknown');
    assert.equal(isNonFastForward(authFailure), false);
    assert.equal(isBlockedByRepositoryRule(authFailure), false);
  });

  it('ignores the generic wrapper message command-stream attaches', () => {
    // command-stream rejects with "Command failed with exit code 1"; the
    // classification has to rest on what git wrote, not on the wrapper.
    const wrapped = {
      message: 'Command failed with exit code 1',
      stdout: '',
      stderr: 'Everything up-to-date',
    };
    assert.equal(classifyPushFailure(wrapped), 'unknown');
  });

  it('reads a bare string as well as a command result', () => {
    assert.equal(
      classifyPushFailure(' ! [rejected] main -> main (non-fast-forward)'),
      'non-fast-forward'
    );
    assert.equal(
      classifyPushFailure('remote: error: GH013:'),
      'repository-rule'
    );
  });

  it('survives a failure with nothing to read', () => {
    for (const empty of [null, undefined, {}, '']) {
      assert.equal(classifyPushFailure(empty), 'unknown');
    }
  });

  it('matches case-insensitively, because git and GitHub disagree on case', () => {
    assert.equal(
      classifyPushFailure({
        stderr: 'REMOTE: ERROR: GH013: REPOSITORY RULE VIOLATIONS',
      }),
      'repository-rule'
    );
    assert.equal(
      classifyPushFailure({
        stderr: '! [REJECTED] main -> main (NON-FAST-FORWARD)',
      }),
      'non-fast-forward'
    );
  });

  it('keeps the pattern lists frozen so a caller cannot widen them', () => {
    assert.throws(() => REPOSITORY_RULE_PATTERNS.push('anything'));
    assert.throws(() => NON_FAST_FORWARD_PATTERNS.push('anything'));
  });
});
