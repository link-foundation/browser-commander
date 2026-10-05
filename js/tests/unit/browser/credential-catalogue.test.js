import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BROWSER_SOURCES } from '../../../src/browser/browser-sources.js';
import { readSafeStoragePassword } from '../../../src/browser/browser-cookie-credentials.js';

describe('catalogue credential identities and Keychain diagnostics', () => {
  it('requests every declared browser service rather than a four-browser table', async () => {
    for (const browser of BROWSER_SOURCES.filter(
      (entry) => entry.safeStorage
    )) {
      for (const name of [browser.id, ...(browser.aliases ?? [])]) {
        const calls = [];
        const password = await readSafeStoragePassword({
          browser: name,
          platform: 'darwin',
          environment: {},
          runCredentialCommand: async (command, args) => {
            calls.push([command, args]);
            return 'synthetic-password';
          },
        });
        assert.equal(password, 'synthetic-password');
        assert.deepEqual(calls, [
          [
            'security',
            ['find-generic-password', '-w', '-s', browser.safeStorage.service],
          ],
        ]);
      }
    }
  });

  for (const outcome of ['denied', 'empty']) {
    it(`identifies the item and retry path when Keychain returns ${outcome}`, async () => {
      await assert.rejects(
        readSafeStoragePassword({
          browser: 'chrome',
          platform: 'darwin',
          runCredentialCommand: async () => {
            if (outcome === 'denied') {
              throw new Error('security exited with code 36');
            }
            return '';
          },
        }),
        /Chrome Safe Storage.*Keychain.*allow.*retry.*refresh=true/s
      );
    });
  }
});
