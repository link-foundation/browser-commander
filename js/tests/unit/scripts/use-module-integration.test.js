/**
 * End-to-end guard for the use-m interop shim.
 *
 * use-module.test.js pins the namespace shapes we normalise; this file loads
 * `command-stream` through the real, unpinned use-m on the same Node version
 * the release jobs run (`node-version: '24.x'`) and asserts `$` is callable.
 * Without it the interop breakage only surfaces on `main`, inside a job that
 * pushes tags and publishes to npm.
 *
 * The test needs network access. When the fetch of use.js or the package
 * install fails, it logs the reason and passes, so offline development and
 * sandboxed runs are not blocked by an unreachable CDN.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  loadCommandStream,
  USE_M_URL,
} from '../../../../scripts/use-module.mjs';

async function hasNetwork() {
  try {
    return (await fetch(USE_M_URL, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

describe('use-m loads command-stream on this Node version', () => {
  it('exposes a callable $ from command-stream', async (t) => {
    if (process.platform === 'win32') {
      // use-m imports the resolved file by its bare absolute path, which the
      // Windows ESM loader rejects with ERR_UNSUPPORTED_ESM_URL_SCHEME. That is
      // an upstream loader bug, independent of the namespace shape this shim
      // normalises; the Linux and macOS runs still cover the interop.
      return t.skip('use-m cannot import absolute paths on Windows');
    }

    if (!(await hasNetwork())) {
      return t.skip(
        `${USE_M_URL} is unreachable, so use-m cannot be evaluated`
      );
    }

    let commandStream;
    try {
      commandStream = await loadCommandStream();
    } catch (error) {
      if (
        /fetch|network|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|registry/i.test(
          error.message
        )
      ) {
        return t.skip(error.message);
      }
      throw error;
    }

    console.log(`Loaded command-stream on ${process.version}`);
    assert.equal(typeof commandStream.$, 'function');
  });
});
