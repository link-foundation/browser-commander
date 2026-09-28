import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { repoPath } from '../../helpers/repo.js';

const SOURCE_ROOT = repoPath('js', 'src');
const DIRECT_SUBPROCESS = /from\s+['"](?:node:)?child_process['"]/u;

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listSourceFiles(entryPath);
    }
    return /\.[cm]?js$/u.test(entry.name) ? [entryPath] : [];
  });
}

describe('subprocesses go through command-stream (issue #104)', () => {
  it('no library module imports node:child_process directly', () => {
    const offenders = listSourceFiles(SOURCE_ROOT)
      .filter((file) => DIRECT_SUBPROCESS.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SOURCE_ROOT, file));
    assert.deepEqual(offenders, []);
  });
});
