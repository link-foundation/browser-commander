import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { makeBrowserCommander } from '../../src/factory.js';
import { readTrace } from '../../src/traces/reader.js';
import { launchE2EBrowser } from '../helpers/e2e-browser.js';

async function activateWithCommander(page, commander) {
  await commander.click({ selector: '#save', waitAfter: false, verify: false });
  await page.focus('#typed');
  await commander.pressKey({ key: 'Enter' });
}

for (const engine of ['playwright', 'puppeteer']) {
  it(
    `records a person's actions and their failed request with ${engine}`,
    {
      skip: process.env.RUN_E2E !== 'true',
      timeout: 60000,
    },
    async () => {
      const output = await fs.mkdtemp(
        path.join(os.tmpdir(), 'bc-user-actions-')
      );
      const server = http.createServer((request, response) => {
        if (request.url === '/delete') {
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end('{"error":"private response body"}');
        } else {
          response.setHeader('content-type', 'text/html');
          response.end(`<!doctype html><form id="form" onsubmit="event.preventDefault()">
          <button id="delete" type="button" aria-label="Delete position">Delete</button>
          <input id="typed"><textarea id="notes"></textarea>
          <button id="save">Save</button></form><div id="result"></div>
          <div id="shadow"></div><iframe srcdoc='<button id="inside">Inside frame</button>'></iframe>
          <script>
            document.querySelector('#delete').onclick = async () => {
              await fetch('/delete', { method: 'DELETE' });
              document.querySelector('#result').textContent = 'Something went wrong on our end';
            };
            document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML = '<button>Shadow action</button>';
          </script>`);
        }
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      let launched, commander;
      try {
        launched = await launchE2EBrowser({ engine });
        const { page } = launched;
        const debugEnvironment = process.env.BROWSER_COMMANDER_DEBUG;
        delete process.env.BROWSER_COMMANDER_DEBUG;
        try {
          commander = makeBrowserCommander({
            page,
            debug: { output },
            enableNavigationManager: false,
          });
          await commander.ready;
        } finally {
          if (debugEnvironment !== undefined) {
            process.env.BROWSER_COMMANDER_DEBUG = debugEnvironment;
          }
        }
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        if (engine === 'playwright') {
          await page.locator('#shadow').getByRole('button').click();
        } else {
          await page.click('#shadow >>> button');
        }
        const frame = page.frames().find((item) => item !== page.mainFrame());
        await frame.click('#inside');
        // Engine input is trusted browser input, just as a physical click is.
        await page.click('#delete');
        await page.waitForFunction(() =>
          document.querySelector('#result').textContent.includes('wrong')
        );
        await page.click('#typed');
        await page.keyboard.type('PRIVATE_TYPED_SENTINEL');
        await page.keyboard.press('Escape');
        await page.click('#save');
        await page.click('#delete', { button: 'right' });
        await page.evaluate(() =>
          document
            .querySelector('#delete')
            .dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
        );
        await page.evaluate(
          () =>
            (document.querySelector('#notes').value =
              'PRIVATE_TEXTAREA_SENTINEL')
        );
        await page.click('#save');
        await activateWithCommander(page, commander);
        await commander.destroy();
        const trace = await readTrace(output),
          actions = trace.events.filter(
            (event) => event.kind === 'interaction'
          );
        const clicks = actions.filter(
          (event) =>
            event.source === 'user' &&
            event.action === 'click' &&
            event.target.path === '#delete'
        );
        assert.equal(clicks.length, 1, 'synthetic events must not be recorded');
        assert.equal(clicks[0].target.role, 'button');
        assert.equal(clicks[0].target.name, 'Delete position');
        assert.equal(clicks[0].target.text, 'Delete');
        assert.ok(
          actions.some(
            (event) => event.source === 'user' && event.action === 'pointerdown'
          )
        );
        assert.ok(
          actions.some(
            (event) =>
              event.source === 'user' && event.target.name === 'Shadow action'
          )
        );
        assert.ok(
          actions.some(
            (event) =>
              event.source === 'user' &&
              event.target.name === 'Inside frame' &&
              event.mainFrame === false
          )
        );
        assert.ok(
          actions.some(
            (event) => event.action === 'keydown' && event.key === 'Escape'
          )
        );
        assert.ok(actions.some((event) => event.action === 'submit'));
        assert.ok(actions.some((event) => event.action === 'contextmenu'));
        assert.equal(
          actions.filter((event) => event.source === 'commander').length,
          2
        );
        assert.equal(
          actions.filter(
            (event) =>
              event.source === 'user' &&
              event.action === 'click' &&
              event.target.path === '#save'
          ).length,
          2
        );
        assert.doesNotMatch(
          JSON.stringify(actions),
          /PRIVATE_(TYPED|TEXTAREA)_SENTINEL/
        );
        const failed = trace.events.find(
            (event) => event.kind === 'network.response' && event.status === 500
          ),
          links = await fs.readFile(path.join(output, 'trace.lino'), 'utf8');
        assert.equal(failed.method, 'DELETE');
        assert.equal(failed.body, undefined, 'network bodies remain opt-in');
        assert.ok(clicks[0].sequence < failed.sequence);
        assert.match(links, /source: user/);
        assert.match(links, /dom-snapshot/);
        assert.match(links, /dom-mutation/);
        assert.match(links, /Something went wrong on our end/);
        assert.match(links, /status: 500/);
      } finally {
        await commander?.destroy();
        await launched?.cleanup();
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(output, { recursive: true, force: true });
      }
    }
  );
}
