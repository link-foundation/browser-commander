import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  clearBrowserCookieMemoryCache,
  getCachedCredential,
} from '../../../src/browser/browser-cookie-cache.js';

async function cleanup(t, directory) {
  t.mock.restoreAll();
  syncBuiltinESMExports();
  clearBrowserCookieMemoryCache();
  await fs.rm(directory, { recursive: true, force: true });
}

test('retries a Windows delete-pending credential lock without rereading the credential', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-cookie-lock-'));
  const realOpen = fs.open;
  let attempted = false;
  let reads = 0;
  // Model the observed Windows exclusive-open EPERM while the previous
  // reader's lock is pending deletion. Other file operations stay real.
  t.mock.method(fs, 'open', async (filename, ...args) => {
    if (filename.endsWith('.lock') && !attempted) {
      attempted = true;
      throw Object.assign(new Error('lock pending deletion'), {
        code: 'EPERM',
      });
    }
    return realOpen(filename, ...args);
  });
  syncBuiltinESMExports();
  try {
    const options = {
      cache: { enabled: true, dir: directory, ttlSeconds: 60 },
      identity: 'windows-lock-contention',
      refresh: false,
      metadata: {},
      platform: 'win32',
      create: async () => {
        reads += 1;
        return Buffer.from('credential');
      },
    };
    assert.deepEqual(
      await getCachedCredential(options),
      Buffer.from('credential')
    );
    clearBrowserCookieMemoryCache();
    assert.deepEqual(
      await getCachedCredential(options),
      Buffer.from('credential')
    );
    assert.equal(reads, 1);
    assert.ok(attempted);
  } finally {
    await cleanup(t, directory);
  }
});

test('does not retry permanent permission errors or Unix EPERM', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'bc-cookie-denied-')
  );
  const realOpen = fs.open;
  try {
    for (const [platform, code] of [
      ['win32', 'EACCES'],
      ['linux', 'EPERM'],
    ]) {
      const error = Object.assign(new Error('access denied'), { code });
      t.mock.method(fs, 'open', async (filename, ...args) => {
        if (filename.endsWith('.lock')) {
          throw error;
        }
        return realOpen(filename, ...args);
      });
      syncBuiltinESMExports();
      await assert.rejects(
        getCachedCredential({
          cache: { enabled: true, dir: directory, ttlSeconds: 60 },
          identity: platform,
          refresh: false,
          metadata: {},
          platform,
          create: async () => {
            throw new Error('must not read credentials');
          },
        }),
        (received) => received === error
      );
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  } finally {
    await cleanup(t, directory);
  }
});
