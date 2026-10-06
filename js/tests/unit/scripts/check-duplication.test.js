/**
 * The duplication gate must print the clones it fails on, not the baseline
 * (issue #128).
 *
 * With the console reporter, `jscpd --baseline … --fail-on-new-clones` lists
 * every clone it finds. A passing run printed 272 "Clone found" blocks, about
 * 840 lines, all of them clones the baseline already accepts. The one clone
 * that fails a run was marked only by a `[NEW]` tag somewhere in that list.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  formatNewClones,
  resolveJscpdCli,
} from '../../../scripts/check-duplication.mjs';
import { repoPath } from '../../helpers/repo.js';

const SCRIPT = repoPath('js/scripts/check-duplication.mjs');

function clone(first, second, isNew) {
  const side = (name, start, end) => ({ name, start, end });
  return {
    format: 'javascript',
    lines: second[2] - second[1] + 1,
    isNew,
    firstFile: side(...first),
    secondFile: side(...second),
  };
}

const REPORT = {
  duplicates: [
    clone(['README.md:javascript', 61, 92], ['src/README.md', 29, 60], false),
    clone(['src/a.js', 21, 40], ['src/b,c.js', 3, 22], true),
  ],
};

describe('formatNewClones', () => {
  it('lists only the clones missing from the baseline', () => {
    const text = formatNewClones(REPORT, { githubActions: false });
    assert.match(text, /src\/a\.js:21-40 ~ src\/b,c\.js:3-22 \(20 lines\)/);
    assert.doesNotMatch(text, /README/);
  });

  it('raises one error annotation per new clone, on the repository path', () => {
    const text = formatNewClones(REPORT, {
      githubActions: true,
      cwd: repoPath('js'),
      workspace: repoPath(),
    });
    const lines = text.trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(
      lines[0],
      '::error file=js/src/a.js,line=21,endLine=40,title=New duplicated code::' +
        '20 lines duplicate js/src/b,c.js:3-22. Extract the shared code, or ' +
        'accept the clone with `npm run check:duplication:update`.'
    );
  });

  it('strips the embedded-language suffix jscpd adds to Markdown code', () => {
    const report = {
      duplicates: [
        clone(
          ['README.md:javascript', 5, 9],
          ['docs/x.md:markdown', 1, 5],
          true
        ),
      ],
    };
    assert.match(
      formatNewClones(report, {
        githubActions: true,
        cwd: repoPath('js'),
        workspace: repoPath(),
      }),
      /^::error file=js\/README\.md,line=5,endLine=9,/
    );
  });
});

describe('check-duplication.mjs end to end', () => {
  function run(cwd) {
    return spawnSync(process.execPath, [SCRIPT], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: '', NO_COLOR: '1' },
    });
  }

  it('is quiet about accepted clones and names a new one', (t) => {
    if (!resolveJscpdCli()) {
      return t.skip('jscpd is not installed; run npm ci in js/');
    }
    const fixture = fs.mkdtempSync(path.join(tmpdir(), 'check-duplication-'));
    try {
      fs.copyFileSync(
        repoPath('js/.jscpd.json'),
        path.join(fixture, '.jscpd.json')
      );
      const body = fs.readFileSync(repoPath('js/src/core/dialog-manager.js'));
      fs.writeFileSync(path.join(fixture, 'one.js'), body);
      fs.writeFileSync(path.join(fixture, 'two.js'), body);
      const update = spawnSync(
        process.execPath,
        [
          resolveJscpdCli(),
          '.',
          '--baseline',
          '.jscpd-baseline.json',
          '--update-baseline',
          '--reporters',
          'silent',
        ],
        { cwd: fixture, encoding: 'utf8' }
      );
      assert.equal(update.status, 0, update.stderr);

      const accepted = run(fixture);
      assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
      assert.doesNotMatch(accepted.stdout, /Clone found|one\.js/);
      assert.match(accepted.stdout, /\d+ clones?, 0 new/);

      fs.writeFileSync(path.join(fixture, 'three.js'), body);
      const failed = run(fixture);
      assert.equal(failed.status, 1, failed.stdout + failed.stderr);
      assert.match(failed.stdout, /^New clone: \S+:\d+-\d+ ~ /m);
      assert.match(failed.stdout, /clones, [1-9]\d* new/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
