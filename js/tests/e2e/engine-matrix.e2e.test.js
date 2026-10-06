/** Native common launch and commander contracts for every JS engine (#124). */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import { launchBrowser } from '../../src/browser/launcher.js';
import { makeBrowserCommander } from '../../src/factory.js';
import { closeServer } from '../helpers/fixture-server.js';
import {
  CHROME_LAUNCH_OPTIONS,
  PARITY_CHROME,
} from '../helpers/e2e-browser.js';

// feature-parity: engines.webdriver@native-typed engines.cli-matrix@native-typed
describe('Common native engine API', { skip: !process.env.RUN_E2E }, () => {
  it(
    'selenium restores portable cookies and BiDi origin state',
    { timeout: 60000 },
    async () => {
      const server = createServer((_request, response) => {
        response.end('<title>Portable state</title>');
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${server.address().port}`;
      let session;
      try {
        session = await launchBrowser({
          engine: 'selenium',
          launch: 'engine',
          bidi: true,
          headless: true,
          executablePath: PARITY_CHROME,
          ...CHROME_LAUNCH_OPTIONS,
          storageState: {
            cookies: [{ name: 'session', value: 'restored', url: origin }],
            origins: [
              { origin, localStorage: [{ name: 'theme', value: 'dark' }] },
            ],
          },
        });
        await session.page.goto(origin);
        assert.equal(
          await session.page.evaluate(() =>
            globalThis.localStorage.getItem('theme')
          ),
          'dark'
        );
        assert.match(
          await session.page.evaluate(() => document.cookie),
          /session=restored/u
        );
      } finally {
        await session?.close();
        await closeServer(server);
      }
    }
  );
  for (const engine of ['playwright', 'puppeteer', 'selenium']) {
    for (const launch of ['real', 'engine']) {
      it(
        `${engine}/${launch}: input, click, native handles, PDF, cleanup`,
        { timeout: 120000 },
        async () => {
          const session = await launchBrowser({
            engine,
            launch,
            headless: true,
            executablePath: PARITY_CHROME,
            ...CHROME_LAUNCH_OPTIONS,
          });
          const commander = makeBrowserCommander({
            page: session.page,
            enableNetworkTracking: false,
            enableNavigationManager: false,
          });
          const profile = session.userDataDir;
          try {
            assert.equal(commander.engine, engine);
            await commander.goto({
              url: `data:text/html,${encodeURIComponent('<input id="name"><button id="go" onclick="document.title=document.querySelector(\'#name\').value">Go</button>')}`,
            });
            await commander.fill({ selector: '#name', text: 'Ada' });
            assert.equal(
              await commander.inputValue({ selector: '#name' }),
              'Ada'
            );
            await commander.click({ selector: '#go' });
            assert.equal(await session.page.title(), 'Ada');
            assert.ok(
              Buffer.from(await session.page.pdf({ format: 'A4' }))
                .subarray(0, 5)
                .equals(Buffer.from('%PDF-'))
            );
            if (engine === 'selenium') {
              assert.equal(await session.driver.getTitle(), 'Ada');
            }
          } finally {
            await commander.destroy();
            await session.close();
          }
          if (session.temporaryProfile) {
            assert.equal(existsSync(profile), false);
          }
        }
      );
    }
  }
});
