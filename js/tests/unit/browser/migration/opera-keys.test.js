import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { localStatePathForProfile } from '../../../../src/browser/migration/os-crypt-keys.js';

it('uses Opera single-profile Local State before a parent fallback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bc-opera-'));
  try {
    const profile = path.join(root, 'Opera Stable');
    await mkdir(profile);
    await writeFile(path.join(root, 'Local State'), '{}');
    await writeFile(path.join(profile, 'Local State'), '{"os_crypt":{}}');
    assert.equal(
      localStatePathForProfile(profile),
      path.join(profile, 'Local State')
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
