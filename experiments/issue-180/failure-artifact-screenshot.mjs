// Writes a failure-artifact screenshot of a page with no fixed viewport and
// reports whether it went through CDP without a clip (issue #180).
// Run: node experiments/issue-180/failure-artifact-screenshot.mjs [--headful]
// CHROME_PATH picks the browser, e.g. Playwright's Chrome for Testing.
import { chromium } from '../../js/node_modules/playwright/index.mjs';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFailureArtifacts } from '../../js/src/tests/index.js';

const browser = await chromium.launch({
  headless: !process.argv.includes('--headful'),
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
});
const context = await browser.newContext({ viewport: null });
const page = await context.newPage();
await page.setContent('<h1>issue 180</h1>');
const sent = [];
const newCDPSession = context.newCDPSession.bind(context);
context.newCDPSession = async (target) => {
  const tracked = await newCDPSession(target);
  const send = tracked.send.bind(tracked);
  tracked.send = (method, params) => {
    sent.push({ method, params });
    return send(method, params);
  };
  return tracked;
};
const dir = mkdtempSync(path.join(os.tmpdir(), 'bc-issue-180-'));
const artifacts = await writeFailureArtifacts({
  page,
  error: new Error('broken'),
  testId: 'resized',
  engine: 'playwright',
  artifactsDir: dir,
});
const png = readFileSync(artifacts[1]);
console.log(
  'artifacts:',
  artifacts.map((file) => path.basename(file))
);
console.log('png signature ok:', png.subarray(1, 4).toString() === 'PNG');
console.log('cdp calls:', JSON.stringify(sent));
await browser.close();
