// feature-parity: elements.reusable@native-typed sessions.runtime@native-typed sessions.workflow@native-typed
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCommander,
  launchBrowser,
  saveStorageState,
} from '../../src/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sendHtml, startFixtureHost } from '../helpers/fixture-server.js';

for (const engine of ['playwright', 'puppeteer']) {
  describe(
    `reusable helpers and session cookies: ${engine}`,
    { skip: !process.env.RUN_E2E, timeout: 60000 },
    () => {
      let browser, page, commander, server;
      before(async () => {
        server = await startFixtureHost((_route, _req, res) =>
          sendHtml(
            res,
            `<p>Hello&nbsp;  world</p>
        <button class="pick disabled">Disabled</button><button class="pick">Choose me</button>
        <input type="checkbox" id="checkbox"><input type="radio" id="radio"><div id="hidden" hidden>Hidden</div>`
          )
        );
        const { chromium } = await import('playwright');
        const options = { headless: true, args: ['--no-sandbox'] };
        if (engine === 'playwright') {
          browser = await chromium.launch(options);
          page = await browser.newPage();
        } else {
          const { default: puppeteer } = await import('puppeteer');
          browser = await puppeteer.launch({
            ...options,
            executablePath: chromium.executablePath(),
          });
          page = await browser.newPage();
        }
        await page.goto(server.baseUrl);
        commander = createCommander({ page, engine });
      });
      after(async () => {
        await commander?.destroy();
        await browser?.close();
        await server?.close();
      });
      it('uses ordered selectors and normalizes nonbreaking spaces only when requested', async () => {
        assert.equal(
          await commander.findFirst({
            selectors: ['#absent', '#hidden', '#checkbox'],
            visible: true,
          }),
          '#checkbox'
        );
        assert.equal(
          await commander.hasText({ texts: ['Hello world'] }),
          false
        );
        assert.equal(
          await commander.hasText({
            texts: ['missing', 'Hello world'],
            normalizeWhitespace: true,
          }),
          true
        );
      });
      it('selects the requested index for enabled checks, clicks and scrolls', async () => {
        assert.equal(
          await commander.isEnabled({ selector: '.pick', index: 0 }),
          false
        );
        assert.equal(
          await commander.isEnabled({ selector: '.pick', index: 1 }),
          true
        );
        await commander.installClickListener({
          buttonText: 'Choose me',
          storageKey: 'picked',
        });
        await commander.scrollIntoView({ selector: '.pick', index: 1 });
        await commander.clickButton({
          selector: '.pick',
          index: 1,
          verify: false,
          waitAfterClick: 0,
          waitForNavigation: false,
        });
        assert.deepEqual(await commander.readFlag({ storageKey: 'picked' }), {
          status: 'observed',
          set: true,
        });
        assert.deepEqual(await commander.readFlag({ storageKey: 'picked' }), {
          status: 'observed',
          set: true,
        });
        assert.equal(
          await commander.uninstallClickListener({ storageKey: 'picked' }),
          true
        );
        await page.evaluate(() => window.sessionStorage.removeItem('picked'));
        await commander.clickButton({
          selector: '.pick',
          index: 1,
          verify: false,
          waitAfterClick: 0,
          waitForNavigation: false,
        });
        assert.deepEqual(await commander.readFlag({ storageKey: 'picked' }), {
          status: 'observed',
          set: false,
        });
      });
      it('checks checkboxes and radios idempotently with native input', async () => {
        assert.equal(
          await commander.isChecked({ selector: '#checkbox' }),
          false
        );
        assert.deepEqual(await commander.check({ selector: '#checkbox' }), {
          checked: true,
          changed: true,
          verified: true,
        });
        assert.deepEqual(await commander.check({ selector: '#checkbox' }), {
          checked: true,
          changed: false,
          verified: true,
        });
        assert.equal(
          (await commander.check({ selector: '#checkbox', checked: false }))
            .verified,
          true
        );
        assert.equal(
          (await commander.check({ selector: '#radio' })).checked,
          true
        );
      });
      it('sets HttpOnly cookies across origins and clears by domain boundary', async () => {
        await commander.setCookies({
          cookies: [
            {
              name: 'session',
              value: 'artificial',
              domain: 'example.test',
              path: '/',
              expires: 0,
              httpOnly: true,
              sameSite: 'lax',
            },
            {
              name: 'keep',
              value: 'artificial',
              domain: 'notexample.test',
              path: '/',
              expires: -1,
            },
          ],
        });
        const state = await saveStorageState(page);
        const session = state.cookies.find(
          (cookie) => cookie.name === 'session'
        );
        assert.ok(session);
        assert.equal(session.httpOnly, true);
        assert.equal(session.expires, -1);
        assert.equal(session.sameSite, 'Lax');
        await commander.clearCookies({ domain: 'example.test' });
        const retained = (await saveStorageState(page)).cookies;
        assert.equal(
          retained.some((cookie) => cookie.name === 'session'),
          false
        );
        assert.equal(
          retained.some((cookie) => cookie.name === 'keep'),
          true
        );
        await commander.clearCookies();
      });
      it('restores opted-in session cookies after closing a dedicated profile', async () => {
        const directory = await mkdtemp(
          path.join(os.tmpdir(), 'bc-persist-e2e-')
        );
        const { chromium } = await import('playwright');
        const options = {
          engine,
          launch: 'engine',
          headless: true,
          executablePath: chromium.executablePath(),
          userDataDir: directory,
          persistSessionCookies: true,
          args: ['--no-sandbox'],
        };
        let result;
        try {
          result = await launchBrowser(options);
          const sessionCommander = createCommander({
            page: result.page,
            engine,
          });
          await sessionCommander.setCookies([
            {
              name: 'session',
              value: 'artificial',
              domain: 'example.test',
              path: '/',
              expires: 0,
              httpOnly: true,
            },
          ]);
          await sessionCommander.destroy();
          await result.close();
          result = await launchBrowser(options);
          const cookies = (await saveStorageState(result.page)).cookies;
          assert.equal(
            cookies.find((cookie) => cookie.name === 'session')?.value,
            'artificial'
          );
        } finally {
          await result?.close();
          await rm(directory, { recursive: true, force: true });
        }
      });
    }
  );
}
