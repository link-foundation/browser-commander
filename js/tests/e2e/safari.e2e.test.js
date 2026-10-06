// feature-parity: safari.control@native-typed
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  launchRealBrowser,
  SafariUnsupportedError,
  makeBrowserCommander,
} from '../../src/index.js';
import { createDispatcher } from '../../src/cli/dispatcher.js';

it(
  'Safari drives a local page in an isolated automation session',
  {
    skip:
      process.platform !== 'darwin' || process.env.RUN_SAFARI_E2E !== 'true',
    timeout: 60_000,
  },
  async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<title>Safari smoke</title><input id="name"><button id="go" onclick="document.querySelector(\'#out\').textContent=document.querySelector(\'#name\').value">Go</button><p id="out"></p>'
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    let session;
    let commander;
    const cli = createDispatcher();
    try {
      session = await launchRealBrowser({
        channel: 'safari',
        startupTimeout: 20_000,
        seedCookies: [{ name: 'seed', value: 'yes', url, httpOnly: true }],
      });
      const { page, driver } = session;
      commander = makeBrowserCommander({ page });
      await page.goto(url);
      assert.equal(commander.engine, 'selenium');
      await commander.fill({ selector: '#name', text: 'Safari' });
      await commander.click({ selector: '#go' });
      assert.equal(
        await page.evaluate(() => document.querySelector('#out').textContent),
        'Safari'
      );
      assert.equal(await page.evaluateAsync(async (value) => value + 1, 4), 5);
      assert.ok((await page.screenshot()).length > 100);
      assert.equal((await driver.manage().getCookie('seed')).value, 'yes');
      const initial = await driver.getWindowHandle();
      for (const type of ['tab', 'window']) {
        const handle = await page.newWindow(type);
        assert.ok((await page.windows()).includes(handle));
        await page.goto(url);
        await driver.close();
        await page.switchToWindow(initial);
      }
      await assert.rejects(() => page.pdf(), SafariUnsupportedError);
      await assert.rejects(
        () => page.setRequestInterception(true),
        SafariUnsupportedError
      );
      await session.close();
      session = await launchRealBrowser({ channel: 'safari' });
      await session.page.goto(url);
      assert.equal(await session.driver.manage().getCookie('seed'), null);
      await session.close();
      await cli.dispatch('session.launch', {
        browser: 'safari',
        engine: 'selenium',
      });
      await cli.dispatch('page.goto', { url });
      assert.equal(
        (await cli.dispatch('page.eval', { expression: 'document.title' }))
          .value,
        'Safari smoke'
      );
    } finally {
      await cli.close();
      await commander?.destroy();
      await session?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  }
);
