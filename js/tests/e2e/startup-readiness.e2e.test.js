import assert from 'node:assert/strict';
import { it } from 'node:test';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser } from '../../src/browser/launcher.js';
import { launchAndConnectRealBrowserWithDependencies } from '../../src/browser/real-browser.js';
import { startProcess } from '../../src/utilities/subprocess.js';
import { CHROME_LAUNCH_OPTIONS } from '../helpers/e2e-browser.js';

it(
  'fresh-profile Chrome starts repeatedly with session persistence',
  { skip: process.env.RUN_E2E !== 'true', timeout: 90000 },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bc-startup-smoke-'));
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const userDataDir = path.join(root, `profile-${attempt}`);
        const session = await launchBrowser({
          debug: false,
          channel: 'chrome',
          headless: true,
          userDataDir,
          persistSessionCookies: true,
          ...CHROME_LAUNCH_OPTIONS,
        });
        try {
          assert.equal(await session.page.evaluate(() => 2 + 2), 4);
        } finally {
          await session.close();
        }
        assert.notEqual(session.browserProcess.exitCode, null);
        await access(userDataDir);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

it(
  'failure after real DevTools readiness leaves another Chrome and caller profile intact',
  { skip: process.env.RUN_E2E !== 'true', timeout: 90000 },
  async () => {
    const sibling = await launchBrowser({
      debug: false,
      headless: true,
      ...CHROME_LAUNCH_OPTIONS,
    });
    const root = await mkdtemp(path.join(os.tmpdir(), 'bc-owned-startup-'));
    const marker = path.join(root, 'keep.txt');
    await writeFile(marker, 'caller profile');
    try {
      for (const suppliedProfile of [false, true]) {
        let child, profile;
        await assert.rejects(
          () =>
            launchAndConnectRealBrowserWithDependencies(
              {
                debug: false,
                headless: true,
                persistSessionCookies: suppliedProfile,
                ...(suppliedProfile ? { userDataDir: root } : {}),
                ...CHROME_LAUNCH_OPTIONS,
              },
              {
                spawnBrowser: (file, args, options) => {
                  profile = args
                    .find((arg) => arg.startsWith('--user-data-dir='))
                    .slice('--user-data-dir='.length);
                  child = startProcess(file, args, { env: options.env });
                  return child;
                },
                connect: async () => {
                  throw new Error(
                    'Injected attachment timeout after endpoint readiness'
                  );
                },
              }
            ),
          /Injected attachment timeout/
        );
        assert.notEqual(child.exitCode, null);
        assert.equal(await sibling.page.evaluate(() => 2 + 2), 4);
        assert.equal(await readFile(marker, 'utf8'), 'caller profile');
        if (!suppliedProfile) {
          await assert.rejects(() => access(profile), /ENOENT/);
        }
      }
    } finally {
      await sibling.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);
