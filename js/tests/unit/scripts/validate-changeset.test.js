/**
 * The changeset check must fail when it cannot see what a pull request adds.
 *
 * Issue #128: when `git diff` against the base failed, the script fell back to
 * every changeset in `.changeset/`, so a stale changeset already on the base
 * branch satisfied "this PR adds exactly one changeset" — a false pass. The
 * fallback stays for local runs, where there is no pull request to compare.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { repoPath } from '../../helpers/repo.js';

const SCRIPT = repoPath('js/scripts/validate-changeset.mjs');

const CHANGESET = `---
'browser-commander': patch
---

::error::not a real annotation
`;

function git(directory, ...args) {
  return spawnSync(
    'git',
    [
      '-C',
      directory,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.com',
      ...args,
    ],
    { encoding: 'utf8' }
  );
}

/** A repository with no origin whose only changeset is already committed. */
function withStaleChangeset(run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'validate-changeset-'));
  const jsDirectory = path.join(directory, 'js');

  try {
    mkdirSync(path.join(jsDirectory, '.changeset'), { recursive: true });
    writeFileSync(path.join(jsDirectory, '.changeset', 'stale.md'), CHANGESET);
    git(directory, 'init', '-q');
    git(directory, 'add', '.');
    git(directory, 'commit', '-q', '-m', 'init');
    return run(jsDirectory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function validate(cwd, env) {
  const base = { ...process.env };
  for (const name of [
    'GITHUB_BASE_REF',
    'GITHUB_BASE_SHA',
    'GITHUB_HEAD_SHA',
    'BASE_SHA',
    'HEAD_SHA',
  ]) {
    delete base[name];
  }

  return spawnSync(process.execPath, [SCRIPT], {
    cwd,
    encoding: 'utf8',
    env: { ...base, GITHUB_ACTIONS: '', ...env },
    timeout: 30_000,
  });
}

describe('validate-changeset', () => {
  it('fails a pull request whose diff cannot be computed', () => {
    withStaleChangeset((cwd) => {
      const result = validate(cwd, { GITHUB_BASE_REF: 'main' });

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, /::error::Could not determine/);
      assert.doesNotMatch(result.stdout, /Changeset validation passed/);
    });
  });

  it('fails when explicit pull request SHAs cannot be compared', () => {
    withStaleChangeset((cwd) => {
      const result = validate(cwd, {
        GITHUB_BASE_SHA: '0'.repeat(40),
        GITHUB_HEAD_SHA: 'HEAD',
      });

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.doesNotMatch(result.stdout, /Changeset validation passed/);
    });
  });

  it('still checks the changesets on disk outside a pull request', () => {
    withStaleChangeset((cwd) => {
      const result = validate(cwd, {});

      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Changeset validation passed/);
    });
  });

  it('does not let the changeset description raise an annotation', () => {
    withStaleChangeset((cwd) => {
      const result = validate(cwd, { GITHUB_ACTIONS: 'true' });

      assert.equal(result.status, 0, result.stdout + result.stderr);
      const token = result.stdout.match(/^::stop-commands::([0-9a-f]{32})$/m);
      assert.ok(token, result.stdout);
      const guarded = result.stdout.split(`::stop-commands::${token[1]}\n`)[1];
      assert.match(
        guarded,
        new RegExp(`^::error::not a real annotation\\n::${token[1]}::$`, 'm')
      );
    });
  });
});
