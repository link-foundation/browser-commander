import { appendFile } from 'node:fs/promises';

import { getCachedCredential } from '../../src/browser/browser-cookie-cache.js';

const [, , cacheDir, credentialReads] = process.argv;

await getCachedCredential({
  cache: { enabled: true, dir: cacheDir, ttlSeconds: 60 },
  identity: 'chrome:linux:safe-storage',
  refresh: false,
  metadata: {
    browser: 'chrome',
    platform: 'linux',
    source: 'safe-storage',
  },
  create: async () => {
    await appendFile(credentialReads, `${process.pid}\n`, 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 250));
    return Buffer.alloc(16, 7);
  },
});
