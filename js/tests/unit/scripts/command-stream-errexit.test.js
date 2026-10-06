/**
 * Guard for the failure mode that made three release defects invisible.
 *
 * `command-stream` resolves its `$` promise on a non-zero exit code instead of
 * rejecting, so the idiom every release script in this repository is written
 * around —
 *
 *   try { await $`some-command`; } catch { process.exit(1); }
 *
 * — is dead code under the library's defaults. On 2026-09-05 that turned a
 * crashed `changeset version` into a green JS release (run 33974450016) and a
 * Rust release that never committed its version bump into a green Rust release
 * (run 33974450069). See dev/log/issues/83/pulls/84/analysis/root-causes.md,
 * RC-B and RC-C.
 *
 * `loadCommandStream()` is the single place every consumer obtains `$` from, so
 * it is the single place the default can be corrected. These tests pin that:
 * a non-zero exit must reject, and the rejection must carry the exit code so a
 * caller can still branch on it.
 *
 * The tests need network access, because use-m is fetched from a CDN. When it
 * is unreachable they skip, matching use-module-integration.test.js.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadCommandStream,
  USE_M_URL,
} from '../../../../scripts/use-module.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

async function hasNetwork() {
  try {
    return (await fetch(USE_M_URL, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

/**
 * Load command-stream, or a reason to skip.
 * @param {import('node:test').TestContext} t
 * @returns {Promise<Record<string, any> | null>}
 */
async function load(t) {
  if (process.platform === 'win32') {
    // Same upstream limitation use-module-integration.test.js documents:
    // use-m imports the resolved file by absolute path, which the Windows ESM
    // loader rejects. The Linux and macOS runs cover this.
    t.skip('use-m cannot import absolute paths on Windows');
    return null;
  }
  if (!(await hasNetwork())) {
    t.skip(`${USE_M_URL} is unreachable, so use-m cannot be evaluated`);
    return null;
  }
  try {
    return await loadCommandStream();
  } catch (error) {
    if (
      /fetch|network|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|registry/i.test(
        error.message
      )
    ) {
      t.skip(error.message);
      return null;
    }
    throw error;
  }
}

/**
 * A test that runs commands through `$`, skipped when it cannot be loaded.
 * @param {string} name
 * @param {(shell: (...args: any[]) => Promise<any>) => Promise<void>} body
 */
function itWithShell(name, body) {
  it(name, async (t) => {
    const $ = (await load(t))?.$;
    if ($) {
      await body($);
    }
  });
}

describe('loadCommandStream makes a failed command fail', () => {
  it('turns errexit on, so the release scripts catch what they try to catch', async (t) => {
    const cs = await load(t);
    if (!cs) {
      return;
    }

    assert.equal(
      cs.shell.settings().errexit,
      true,
      'errexit must be enabled by loadCommandStream; with the library default ' +
        'of false, every try/catch around $ in the release scripts is unreachable'
    );
  });

  itWithShell(
    'rejects on a non-zero exit and reports the exit code',
    async ($) => {
      // A real process, as in the release scripts. command-stream's virtual
      // `exit` builtin would also reject, but it writes "Command failed with
      // exit code 7" to stderr on top, which surfaced as a stray line at the end
      // of every CI test log (issue #128).
      await assert.rejects(
        () => $`sh -c "exit 7"`,
        (error) => {
          assert.equal(
            error.code,
            7,
            'the exit code must survive on the error'
          );
          return true;
        },
        'a command exiting 7 must reject, not resolve'
      );
    }
  );

  itWithShell('still resolves with stdout on success', async ($) => {
    // errexit must not turn every command into a throw: the success path is
    // what the release scripts read version numbers and git status out of.
    const result = await $`echo errexit-ok`;
    assert.match(String(result.stdout), /errexit-ok/);
  });

  itWithShell(
    'reports a non-zero exit for the exact command that broke the Rust release',
    async ($) => {
      // `git diff --cached --quiet` exits 1 when there ARE staged changes.
      // rust/scripts/version-and-commit.mjs relied on that becoming a rejection
      // and, because it did not, reported "No changes to commit" after staging
      // two modified files. `false` stands in for it here so the test needs no
      // git fixture; the contract under test is identical.
      await assert.rejects(() => $`false`, 'a command exiting 1 must reject');
    }
  );
});

describe('command-stream quotes interpolated values itself', () => {
  // `${value}` in a `$` template is passed through as one argument, quoted by
  // the library. Escaping by hand on top of that is not a no-op: inside
  // `"${…}"` the backslashes survive into the argument. CodeQL flagged the
  // hand escaping in js/scripts/version-and-commit.mjs
  // (js/incomplete-sanitization, issue #128); this pins why it was removed.
  const message = 'a "quoted" $HOME `id` back\\slash';

  itWithShell('passes a bare interpolation through unchanged', async ($) => {
    const result = await $({ mirror: false })`printf '%s' ${message}`;
    assert.equal(String(result.stdout), message);
  });

  itWithShell('keeps hand-added backslashes inside quotes', async ($) => {
    const escaped = message.replace(/"/g, '\\"');
    const result = await $({ mirror: false })`printf '%s' "${escaped}"`;
    assert.notEqual(String(result.stdout), message);
  });

  it('no release script escapes quotes by hand before interpolating', () => {
    const offenders = ['js/scripts', 'rust/scripts']
      .flatMap((dir) =>
        readdirSync(join(REPO_ROOT, dir))
          .filter((name) => name.endsWith('.mjs'))
          .map((name) => join(dir, name))
      )
      .filter((file) =>
        /\.replace\(\/"\/g/.test(readFileSync(join(REPO_ROOT, file), 'utf8'))
      );
    assert.deepEqual(offenders, []);
  });
});
