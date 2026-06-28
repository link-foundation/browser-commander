import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { removeDeprecatedAlwaysAuth } from '../../../scripts/clean-npm-config.mjs';
import {
  formatRegistryPackagePath,
  isVersionPublished,
} from '../../../scripts/npm-registry.mjs';
import {
  buildNodeTestArgs,
  parseTestRunnerArgs,
  resolveTestFiles,
} from '../../../scripts/run-tests.mjs';

describe('npm release helpers', () => {
  describe('removeDeprecatedAlwaysAuth', () => {
    it('removes always-auth while preserving other config', () => {
      const dir = mkdtempSync(join(tmpdir(), 'browser-commander-npmrc-'));
      const npmrc = join(dir, '.npmrc');

      try {
        writeFileSync(
          npmrc,
          [
            '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}',
            'always-auth=true',
            'registry=https://registry.npmjs.org/',
            '',
          ].join('\n')
        );

        assert.equal(removeDeprecatedAlwaysAuth(npmrc), true);
        assert.equal(
          readFileSync(npmrc, 'utf8'),
          [
            '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}',
            'registry=https://registry.npmjs.org/',
            '',
          ].join('\n')
        );
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    });

    it('returns false when no config path exists', () => {
      assert.equal(removeDeprecatedAlwaysAuth(''), false);
    });
  });

  describe('isVersionPublished', () => {
    it('returns false for npm registry 404 responses without logging npm errors', async () => {
      const fetchCalls = [];
      const fetchFn = async (url) => {
        fetchCalls.push(url);
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
        };
      };

      const published = await isVersionPublished(
        'browser-commander',
        '0.9.0',
        fetchFn
      );

      assert.equal(published, false);
      assert.deepEqual(fetchCalls, [
        'https://registry.npmjs.org/browser-commander/0.9.0',
      ]);
    });

    it('handles scoped package names', () => {
      assert.equal(
        formatRegistryPackagePath('@scope/package'),
        '%40scope%2Fpackage'
      );
    });
  });
});

describe('test runner helper', () => {
  it('expands test directories into stable explicit test files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-commander-tests-'));

    try {
      writeFileSync(join(dir, 'root.test.js'), '');
      writeFileSync(join(dir, 'ignored.js'), '');

      const nestedDir = join(dir, 'nested');
      mkdirSync(nestedDir);
      writeFileSync(join(nestedDir, 'nested.test.js'), '');

      assert.deepEqual(resolveTestFiles([dir], dir), [
        join('nested', 'nested.test.js'),
        'root.test.js',
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it('builds node --test arguments with reporter and coverage options', () => {
    const options = parseTestRunnerArgs([
      '--coverage',
      '--reporter',
      'spec',
      '--env',
      'RUN_E2E=true',
      'tests/unit',
    ]);

    assert.deepEqual(options, {
      coverage: true,
      env: { RUN_E2E: 'true' },
      reporter: 'spec',
      targets: ['tests/unit'],
    });
    assert.deepEqual(buildNodeTestArgs(options, ['tests/unit/a.test.js']), [
      '--test',
      '--experimental-test-coverage',
      '--test-reporter',
      'spec',
      'tests/unit/a.test.js',
    ]);
  });
});
