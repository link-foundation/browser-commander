import assert from 'node:assert/strict';
import { it } from 'node:test';
import { connectBrowserWithDependencies } from '../../../src/browser/connector.js';

it('identifies an engine attachment failure and logs stage timing only when verbose', async (t) => {
  const logs = [];
  t.mock.method(console, 'log', (message) => logs.push(message));
  for (const verbose of [false, true]) {
    logs.length = 0;
    await assert.rejects(
      () =>
        connectBrowserWithDependencies(
          { cdpEndpoint: 'http://127.0.0.1:9222', verbose, timeout: 123 },
          {
            loadPlaywright: async () => ({
              chromium: {
                connectOverCDP: async (_endpoint, options) => {
                  assert.equal(options.timeout, 123);
                  throw new Error('connectOverCDP: Timeout 123ms exceeded');
                },
              },
            }),
          }
        ),
      (error) => {
        assert.equal(error.attachmentStage, 'engine-connect');
        return true;
      }
    );
    if (verbose) {
      assert.ok(logs.some((message) => /engine-connect started/.test(message)));
      assert.ok(
        logs.some((message) =>
          /engine-connect failed after \d+ms/.test(message)
        )
      );
    } else {
      assert.deepEqual(logs, []);
    }
  }
});

it('distinguishes page selection from engine connection and detaches on failure', async () => {
  let detached = 0;
  const browser = {
    contexts: () => [
      {
        pages: () => [],
        newPage: async () => {
          throw new Error('newPage timeout');
        },
      },
    ],
    close: async () => {
      detached++;
    },
  };
  await assert.rejects(
    () =>
      connectBrowserWithDependencies(
        { cdpEndpoint: 'http://127.0.0.1:9222' },
        {
          loadPlaywright: async () => ({
            chromium: { connectOverCDP: async () => browser },
          }),
        }
      ),
    (error) => {
      assert.equal(error.attachmentStage, 'page-selection');
      return true;
    }
  );
  assert.equal(detached, 1);
});
