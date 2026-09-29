import { chromium } from '../../js/node_modules/playwright/index.mjs';
import { createCommander } from '../../js/src/index.js';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.error('page error:', error.message));
  page.on('console', (message) => console.log('console:', message.text()));
  const commander = createCommander({ page, verbose: true });
  await commander.goto({
    url: process.env.TEST_URL || 'http://127.0.0.1:3000',
  });
  console.log(
    'title:',
    await page.locator('[data-testid="page-title"]').textContent()
  );
  await commander.click({ selector: '[data-testid="dropdown-trigger"]' });
  console.log(
    'dropdown visible:',
    await commander.isVisible({ selector: '[data-testid="dropdown-menu"]' })
  );
  await commander.click({
    selector: '[data-testid="dropdown-option-option-a"]',
  });
  console.log(
    'selected:',
    await page.locator('[data-testid="dropdown-selected"]').textContent()
  );
  console.log('before:', await page.locator('[data-testid="modal"]').count());
  await commander.click({ selector: '[data-testid="btn-open-modal"]' });
  console.log('after:', await page.locator('[data-testid="modal"]').count());
  console.log(
    'modal visible:',
    await commander.isVisible({ selector: '[data-testid="modal"]' })
  );
} finally {
  await browser.close();
}
