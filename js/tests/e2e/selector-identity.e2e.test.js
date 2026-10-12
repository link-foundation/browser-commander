import assert from 'node:assert/strict';
import { it } from 'node:test';
import { makeBrowserCommander } from '../../src/factory.js';
import { launchE2EBrowser } from '../helpers/e2e-browser.js';

for (const engine of ['playwright', 'puppeteer', 'selenium']) {
  it(
    `${engine} keeps scoped text selectors on the intended element`,
    { skip: process.env.RUN_E2E !== 'true', timeout: 60000 },
    async () => {
      const session = await launchE2EBrowser({ engine });
      const commander = makeBrowserCommander({
        page: session.page,
        verbose: false,
        debug: false,
        enableNetworkTracking: false,
        enableNavigationManager: false,
      });
      try {
        await session.page.setContent(`
          <nav><button>A</button><button data-qa='duplicate'
            onclick="window.clicked='nav-2'">B</button></nav>
          <div class="parent"><section><button>A</button>
            <button data-qa='duplicate' data-target='B'
              onclick="window.clicked='B'; this.setAttribute('aria-pressed','true')">B</button>
            <textarea>Edit</textarea>
          </section></div>`);
        for (const exact of [false, true]) {
          const selector = await commander.findByText({
            selector: '.parent button',
            text: 'B',
            exact,
          });
          assert.equal(
            await commander.getAttribute({
              selector,
              attribute: 'data-target',
            }),
            'B'
          );
          assert.equal(await commander.textContent({ selector }), 'B');
          assert.equal(await commander.isVisible({ selector }), true);
          assert.equal(await commander.isEnabled({ selector }), true);
          await commander.clickButton({ selector, verify: false });
          assert.equal(await session.page.evaluate(() => window.clicked), 'B');
        }
        const editable = await commander.findByText({
          selector: '.parent textarea',
          text: 'Edit',
          exact: true,
        });
        await commander.fillTextArea({
          selector: editable,
          text: 'Changed',
          checkEmpty: false,
          simulateTyping: false,
        });
        assert.equal(
          await session.page.evaluate(
            () => document.querySelector('.parent textarea').value
          ),
          'Changed'
        );
      } finally {
        await commander.destroy();
        await session.cleanup();
      }
    }
  );
}

it(
  'Playwright preserves CSS sibling position across multiple parents',
  { skip: process.env.RUN_E2E !== 'true', timeout: 60000 },
  async () => {
    const session = await launchE2EBrowser({ engine: 'playwright' });
    const commander = makeBrowserCommander({
      page: session.page,
      debug: false,
      enableNetworkTracking: false,
      enableNavigationManager: false,
    });
    try {
      await session.page.setContent(
        '<section><span></span><button>A</button></section><section><button>B</button><button>C</button></section>'
      );
      const matches = await commander.querySelectorAll({
        selector: 'section button:nth-of-type(2)',
      });
      assert.equal(matches.length, 1);
      assert.equal(await matches[0].textContent(), 'C');
    } finally {
      await commander.destroy();
      await session.cleanup();
    }
  }
);
