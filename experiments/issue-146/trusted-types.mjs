import { execFileSync } from 'node:child_process';
import { chromium } from '../../js/node_modules/playwright/index.mjs';
import { captureSnapshotInPage } from '../../js/src/traces/page-capture.js';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'">
    <h1>Trusted Types checkpoint</h1><div id="host"></div>`);
  await page.evaluate(() => {
    const shadow = document
      .querySelector('#host')
      .attachShadow({ mode: 'open' });
    const field = document.createElement('input');
    field.setAttribute('type', 'password');
    field.value = 'secret-in-shadow';
    shadow.appendChild(field);
    const text = document.createElement('span');
    text.textContent = 'Visible shadow content';
    shadow.appendChild(text);
  });
  const original = execFileSync(
    'git',
    ['show', 'origin/main:js/src/traces/page-capture.js'],
    { encoding: 'utf8' }
  );
  // Extract the function body without its trailing comments using a data URL.
  const oldModule = await import(
    `data:text/javascript,${encodeURIComponent(original.replace(/export const RECORDER_GLOBAL/, 'const RECORDER_GLOBAL'))}`
  );
  await assert.rejects(
    page.evaluate(oldModule.captureSnapshotInPage, {
      redactSelectors: ['input[type=password]'],
    }),
    /TrustedHTML/
  );
  const snapshot = await page.evaluate(captureSnapshotInPage, {
    redactSelectors: ['input[type=password]'],
  });
  assert.ok(snapshot.html.includes('Visible shadow content'));
  assert.ok(!snapshot.html.includes('secret-in-shadow'));
  assert.ok(snapshot.html.includes('[redacted]'));
  console.log(
    'Original checkpoint fails under Trusted Types; fixed checkpoint preserves shadow DOM and redacts secrets.'
  );
} finally {
  await browser.close();
}
