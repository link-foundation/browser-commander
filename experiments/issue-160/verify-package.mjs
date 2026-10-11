#!/usr/bin/env node
/** Verify public imports and README destinations from an actual npm tarball. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-package-160-'));
try {
  const result = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], {
      cwd: path.join(root, 'js'),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
  );
  execFileSync('tar', [
    '-xzf',
    path.join(scratch, result[0].filename),
    '-C',
    scratch,
  ]);
  const packaged = path.join(scratch, 'package');
  await fs.symlink(
    path.join(root, 'js/node_modules'),
    path.join(packaged, 'node_modules'),
    'dir'
  );
  const exports = await import(
    pathToFileURL(path.join(packaged, 'src/index.js'))
  );
  for (const name of [
    'renderTrace',
    'summarizeTrace',
    'startTrace',
    'readTrace',
  ]) {
    assert.equal(typeof exports[name], 'function', `${name} public export`);
  }
  const readme = await fs.readFile(path.join(packaged, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /\]\(\.\.\/docs\//);
  const guides = readme.matchAll(
    /https:\/\/github\.com\/link-foundation\/browser-commander\/blob\/[^/]+\/(docs\/[^)#\s]+)/g
  );
  let guideCount = 0;
  for (const guide of guides) {
    await fs.access(path.join(root, guide[1]));
    guideCount++;
  }
  assert.ok(guideCount > 0, 'installed README has valid repository guides');
  for (const name of ['readyOn', 'concurrency', 'overlays']) {
    assert.ok(readme.includes(name));
  }
  console.log(
    'npm tarball: public trace exports and installed README links verified'
  );
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
