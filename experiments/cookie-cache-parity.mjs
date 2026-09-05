import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { getCachedCredential } from '../js/src/browser/browser-cookie-cache.js';

const execFile = promisify(execFileCallback);
const repositoryRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url))
);
const temporaryDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'browser-commander-cookie-cache-parity-')
);
const expectedKey = Buffer.alloc(16, 7);

try {
  await getCachedCredential({
    cache: {
      enabled: true,
      dir: temporaryDirectory,
      ttlSeconds: 60,
    },
    identity: 'chrome:linux:safe-storage',
    refresh: false,
    metadata: {
      browser: 'chrome',
      platform: 'linux',
      source: 'safe-storage',
    },
    create: () => Promise.resolve(expectedKey),
  });

  const pythonSource = `
from pathlib import Path
import sys

from browser_commander.browser.browser_cookie_cache import (
    NormalizedCookieCache,
    get_cached_credential,
)

cache = NormalizedCookieCache(True, Path(sys.argv[1]), 60.0)
key = get_cached_credential(
    cache,
    "chrome:linux:safe-storage",
    lambda: (_ for _ in ()).throw(RuntimeError("credential provider was called")),
    refresh=False,
    metadata={},
)
assert key == bytes([7]) * 16
`;
  const pythonPath = path.join(repositoryRoot, 'python', 'src');
  await execFile(
    process.env.PYTHON ?? 'python',
    ['-c', pythonSource, temporaryDirectory],
    {
      env: {
        ...process.env,
        PYTHONPATH: [pythonPath, process.env.PYTHONPATH]
          .filter(Boolean)
          .join(path.delimiter),
      },
    }
  );

  assert.ok(true, 'Python reused the JavaScript-derived credential cache');
  console.log('JavaScript/Python cookie credential cache parity passed');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
