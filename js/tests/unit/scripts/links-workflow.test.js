/**
 * links.yml runs lychee with `--cache`, which reads and writes `.lycheecache`
 * in the workspace. Every job starts from a fresh checkout, so without a step
 * that restores and saves that file the flag does nothing: each run checked
 * every link from scratch, while the job comment promised "<1min with the
 * lychee cache" (issue #128). The lychee-action README pairs the flag with
 * actions/cache for this reason.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { repoPath } from '../../helpers/repo.js';

const workflow = readFileSync(
  repoPath('.github/workflows/links.yml'),
  'utf8'
).replaceAll('\r\n', '\n');

describe('links.yml lychee cache', () => {
  const lycheeStep = workflow.indexOf('uses: lycheeverse/lychee-action@');
  const usesCacheFlag = /^\s+--cache\s*$/m.test(workflow);

  it('runs lychee', () => {
    assert.ok(lycheeStep > 0, 'lychee step not found');
  });

  it('restores .lycheecache before lychee when --cache is on', () => {
    if (!usesCacheFlag) {
      return;
    }
    const cacheStep = workflow.search(
      /uses: actions\/cache@\S+\n\s+with:\n\s+path: \.lycheecache\n/
    );
    assert.ok(
      cacheStep > 0,
      '--cache needs an actions/cache step for .lycheecache'
    );
    assert.ok(cacheStep < lycheeStep, 'the cache must be restored first');
  });
});
