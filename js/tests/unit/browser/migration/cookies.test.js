import assert from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  DBSC_BOUND_COOKIE_NAMES,
  isDbscBoundCookie,
  migrateCookies,
} from '../../../../src/browser/migration/cookies.js';

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bc-cookies-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('isDbscBoundCookie', () => {
  it('flags rotating Google session-token cookies', () => {
    for (const name of DBSC_BOUND_COOKIE_NAMES) {
      assert.equal(
        isDbscBoundCookie({ name, domain: '.google.com' }),
        true,
        name
      );
    }
    assert.equal(
      isDbscBoundCookie({ name: 'SID', domain: '.google.com' }),
      false
    );
    assert.equal(
      isDbscBoundCookie({ name: '__Secure-1PSIDTS', domain: '.example.com' }),
      false
    );
  });
});

describe('migrateCookies', () => {
  it('dedupes across domain filters and tags DBSC-bound cookies', async () => {
    const calls = [];
    const readCookies = async ({ domainFilter }) => {
      calls.push(domainFilter);
      if (domainFilter === 'google.com') {
        return [
          { name: '__Secure-1PSIDTS', domain: '.google.com', path: '/' },
          { name: 'SID', domain: '.google.com', path: '/' },
        ];
      }
      return [{ name: 'session', domain: '.example.com', path: '/' }];
    };

    const report = await migrateCookies({
      browser: 'chrome',
      domains: ['google.com', 'example.com'],
      readCookies,
    });

    assert.deepEqual(calls, ['google.com', 'example.com']);
    assert.equal(report.cookies.length, 3);
    assert.equal(report.migrated, 3);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.skipped[0].reason, 'dbsc-bound');
  });

  it('warns when the source has a DBSC registration database', async () => {
    const sourceProfileDir = await makeTempDir();
    await mkdir(path.join(sourceProfileDir, 'Network'), { recursive: true });
    await writeFile(
      path.join(sourceProfileDir, 'Network', 'DeviceBoundSessions'),
      'x'
    );

    const report = await migrateCookies({
      browser: 'chrome',
      sourceProfileDir,
      readCookies: async () => [
        { name: 'a', domain: '.example.com', path: '/' },
      ],
    });

    assert.equal(report.warnings.length, 1);
    assert.equal(report.warnings[0].reason, 'dbsc-registration-present');
  });

  it('passes ignoreDecryptionErrors to the reader', async () => {
    let seen;
    await migrateCookies({
      browser: 'chrome',
      readCookies: async (options) => {
        seen = options;
        return [];
      },
    });
    assert.equal(seen.ignoreDecryptionErrors, true);
  });
});
