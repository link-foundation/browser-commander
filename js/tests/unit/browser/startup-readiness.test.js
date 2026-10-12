import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import {
  launchAndConnectRealBrowserWithDependencies,
  waitForCdpEndpoint,
} from '../../../src/browser/real-browser.js';

it(
  'waits for HTTP readiness after DevTools is announced, despite incidental warnings',
  { timeout: 5000 },
  async () => {
    const stderr = new PassThrough();
    stderr.write(
      'DevTools listening on ws://127.0.0.1:9777/devtools/browser/ours\nCVDisplayLinkCreateWithCGDisplay failed\n'
    );
    let probes = 0;
    const endpoint = await waitForCdpEndpoint({
      remoteDebuggingPort: 9777,
      userDataDir: '/nonexistent',
      browserProcess: { exitCode: null, stderr },
      timeout: 2000,
      fetchImplementation: async () => {
        probes++;
        if (probes === 1) {
          throw new Error('ECONNREFUSED');
        }
        if (probes === 2) {
          return { ok: false };
        }
        return {
          ok: true,
          json: async () => ({
            webSocketDebuggerUrl: 'ws://127.0.0.1:9777/devtools/browser/ours',
          }),
        };
      },
    });
    assert.equal(endpoint, 'http://127.0.0.1:9777');
    assert.equal(probes, 3);
  }
);

for (const suppliedProfile of [false, true]) {
  it(
    `attachment timeout cleans only owned state (supplied profile: ${suppliedProfile})`,
    { timeout: 5000 },
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-startup-test-'));
      const marker = path.join(root, 'keep.txt');
      await fs.writeFile(marker, 'caller owned');
      let profile;
      let kills = 0;
      let launches = 0;
      const child = {
        exitCode: null,
        stderrTail:
          'DevTools listening on ws://127.0.0.1:9777/devtools/browser/ours\nCVDisplayLinkCreateWithCGDisplay failed',
        kill: () => {
          kills++;
          child.exitCode = 143;
        },
      };
      try {
        await assert.rejects(
          () =>
            launchAndConnectRealBrowserWithDependencies(
              {
                ...(suppliedProfile ? { userDataDir: root } : {}),
                debug: false,
                headless: true,
                persistSessionCookies: suppliedProfile,
                timeout: 123,
                closeTimeout: 50,
              },
              {
                resolveExecutable: async () => '/opt/google/chrome',
                reservePort: async () => 9777,
                spawnBrowser: (_file, args) => {
                  launches++;
                  profile = args
                    .find((arg) => arg.startsWith('--user-data-dir='))
                    .slice('--user-data-dir='.length);
                  return child;
                },
                waitForEndpoint: async () => 'http://127.0.0.1:9777',
                connect: async (options) => {
                  assert.equal(options.timeout, 123);
                  const error = new Error(
                    'connectOverCDP: Timeout 123ms exceeded'
                  );
                  error.attachmentStage = 'engine-connect';
                  throw error;
                },
              }
            ),
          (error) => {
            assert.equal(error.phase, 'connect');
            assert.equal(error.category, 'startup_timeout');
            assert.equal(error.attachmentStage, 'engine-connect');
            assert.match(
              error.message,
              /connectOverCDP: Timeout 123ms exceeded/
            );
            assert.match(error.message, /CVDisplayLink/);
            return true;
          }
        );
        assert.equal(kills, 1);
        assert.equal(launches, 1);
        assert.equal(await fs.readFile(marker, 'utf8'), 'caller owned');
        if (!suppliedProfile) {
          await assert.rejects(
            () => fs.readFile(path.join(profile, 'First Run')),
            /ENOENT/
          );
        }
      } finally {
        await fs.rm(root, { recursive: true, force: true });
        if (!suppliedProfile && profile) {
          await fs.rm(profile, { recursive: true, force: true });
        }
      }
    }
  );
}
