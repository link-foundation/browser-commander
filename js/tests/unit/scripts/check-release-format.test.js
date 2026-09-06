/**
 * Guard for RC-E: the release commit that no workflow run ever checks.
 *
 * `version-and-commit.mjs` pushes the bump with `GITHUB_TOKEN`, and a push
 * authenticated with `GITHUB_TOKEN` does not start a workflow run. When
 * `changeset version` wrote a CHANGELOG.md that Prettier rejects, main's
 * `format:check` went red and stayed red: the runs that could have reported it
 * were exactly the ones the push never triggered.
 *
 * Analysis: dev/log/issues/83/pulls/84/analysis/root-causes.md, RC-E
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  FORMAT_CHECK_COMMAND,
  assertGeneratedFilesAreFormatted,
  formatFailureAnnotation,
  formatFailureDetails,
} from '../../../scripts/check-release-format.mjs';

const jsRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** @returns {{log: (m: string) => void, error: (m: string) => void, lines: string[], errors: string[]}} */
function recorder() {
  const lines = [];
  const errors = [];
  return {
    lines,
    errors,
    log: (message) => lines.push(String(message)),
    error: (message) => errors.push(String(message)),
  };
}

describe('release commit formatting gate', () => {
  it('lets a formatted release commit through', async () => {
    const console_ = recorder();
    let ran = 0;

    await assertGeneratedFilesAreFormatted(async () => {
      ran += 1;
    }, console_);

    assert.equal(ran, 1);
    assert.equal(console_.errors.length, 0);
    assert.ok(console_.lines.some((line) => line.includes('is formatted')));
  });

  it('stops the release when the generated files fail the gate', async () => {
    const console_ = recorder();
    const failure = Object.assign(
      new Error('Command failed with exit code 1'),
      { stdout: '[warn] CHANGELOG.md\n', stderr: '' }
    );

    await assert.rejects(
      assertGeneratedFilesAreFormatted(async () => {
        throw failure;
      }, console_),
      // Rethrown unchanged: the caller's catch reports it and exits non-zero,
      // so the push never happens.
      (error) => error === failure
    );

    assert.ok(console_.errors[0].startsWith('::error title='));
    assert.ok(console_.errors.includes('[warn] CHANGELOG.md'));
  });

  it('keeps the annotation on one line', () => {
    // A workflow command ends at the first newline; anything after it is
    // printed as plain log text and never becomes an annotation.
    assert.ok(!formatFailureAnnotation().includes('\n'));
    assert.ok(formatFailureAnnotation().startsWith('::error title='));
  });

  it('reads the reason out of the captured streams, not the message', () => {
    // With errexit on, `error.message` is only "Command failed with exit code
    // N". A call site that reported `message` would say nothing useful.
    const details = formatFailureDetails({
      message: 'Command failed with exit code 1',
      stdout: '  [warn] CHANGELOG.md  ',
      stderr: 'prettier: not found',
    });

    assert.equal(details, '[warn] CHANGELOG.md\nprettier: not found');
    assert.equal(formatFailureDetails(new Error('boom')), '');
    assert.equal(formatFailureDetails(undefined), '');
  });

  it('runs the same gate the lint job runs', () => {
    // A gate that drifts from the one CI uses would pass here and fail there.
    const workflow = readFileSync(
      join(jsRoot, '../.github/workflows/js.yml'),
      'utf8'
    );
    assert.ok(
      workflow.includes(`run: ${FORMAT_CHECK_COMMAND}`),
      `${FORMAT_CHECK_COMMAND} is no longer the workflow's formatting gate`
    );

    const script = readFileSync(
      join(jsRoot, 'scripts/version-and-commit.mjs'),
      'utf8'
    );
    assert.ok(
      script.includes(FORMAT_CHECK_COMMAND),
      'version-and-commit.mjs must run the same command it documents'
    );
  });

  it('checks before it commits, not after it pushes', () => {
    const script = readFileSync(
      join(jsRoot, 'scripts/version-and-commit.mjs'),
      'utf8'
    );
    const check = script.indexOf('assertGeneratedFilesAreFormatted(() =>');
    const commit = script.indexOf('git commit');
    // The raw `git push origin main` this used to look for is now
    // pushWithRebaseRetry, which rebases when another release wrote to main
    // first. See dev/log/issues/85/pulls/86/analysis/root-causes.md (RC-1).
    const push = script.indexOf('pushWithRebaseRetry({');

    assert.ok(check > 0 && commit > 0 && push > 0);
    assert.ok(
      check < commit && check < push,
      'a check that runs after the push cannot stop a bad release commit'
    );
  });
});
