/**
 * Contributor-authored text must not become a workflow command.
 *
 * GitHub Actions reads any log line that starts with `::name::` or `##[name]`
 * as a command, so a changeset that quotes `::error::` printed bare raises a
 * fake annotation — and `::add-mask::`, `::stop-commands::` or `::debug::` can
 * change what the rest of the log shows. Issue #128 adopts the
 * link-foundation templates' guard (rust template issue #173).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { printUntrusted } from '../../../../scripts/github-actions-log.mjs';
import { repoPath } from '../../helpers/repo.js';

function capturePrint(value, options = {}) {
  let output = '';
  printUntrusted(value, {
    stream: { write: (chunk) => (output += chunk) },
    ...options,
  });
  return output;
}

describe('github-actions-log printUntrusted', () => {
  it('prints local output unchanged', () => {
    assert.equal(
      capturePrint('quoted ::error:: text', { githubActions: false }),
      'quoted ::error:: text\n'
    );
  });

  it('brackets the whole value while GitHub interprets commands', () => {
    const output = capturePrint('first\n::error::not a real annotation', {
      githubActions: true,
      tokenFactory: () => '0123456789abcdef0123456789abcdef',
    });

    assert.equal(
      output,
      [
        '::stop-commands::0123456789abcdef0123456789abcdef',
        'first',
        '::error::not a real annotation',
        '::0123456789abcdef0123456789abcdef::',
        '',
      ].join('\n')
    );
  });

  it('uses a fresh 128-bit token for every print', () => {
    const tokenPattern = /^::stop-commands::([0-9a-f]{32})$/m;
    const first = capturePrint('a', { githubActions: true });
    const second = capturePrint('b', { githubActions: true });
    const firstToken = first.match(tokenPattern)?.[1];
    const secondToken = second.match(tokenPattern)?.[1];

    assert.ok(firstToken && secondToken);
    assert.notEqual(firstToken, secondToken);
    assert.ok(first.endsWith(`::${firstToken}::\n`));
  });

  it('follows GITHUB_ACTIONS when not told otherwise', () => {
    const saved = process.env.GITHUB_ACTIONS;

    try {
      process.env.GITHUB_ACTIONS = 'true';
      assert.match(capturePrint('x'), /^::stop-commands::/);
      process.env.GITHUB_ACTIONS = '';
      assert.equal(capturePrint('x'), 'x\n');
    } finally {
      if (saved === undefined) {
        delete process.env.GITHUB_ACTIONS;
      } else {
        process.env.GITHUB_ACTIONS = saved;
      }
    }
  });

  it('guards every script that prints a changeset or release description', () => {
    for (const file of [
      'js/scripts/validate-changeset.mjs',
      'js/scripts/merge-changesets.mjs',
      'js/scripts/create-manual-changeset.mjs',
      'js/scripts/version-and-commit.mjs',
    ]) {
      const source = readFileSync(repoPath(file), 'utf8');

      assert.match(
        source,
        /from '\.\.\/\.\.\/scripts\/github-actions-log\.mjs'/,
        file
      );
      assert.match(source, /printUntrusted\(/, file);
    }
  });
});
