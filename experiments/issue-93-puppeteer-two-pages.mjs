/**
 * Where does a second page wedge Puppeteer? (issue #93)
 *
 * The multi-frame regression test hangs in `page.click` under Puppeteer only,
 * at Puppeteer's 180s protocol timeout, so this runs the same steps one at a
 * time and prints how long each of them took.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { makeBrowserCommander } from '../js/src/factory.js';
import { startTrace } from '../js/src/traces/recorder.js';
import { TRACE_MODE } from '../js/src/traces/schema.js';
import { launchE2EBrowser } from '../js/tests/helpers/e2e-browser.js';
import { startTraceServer } from '../js/tests/helpers/trace-server.js';

const step = async (what, run) => {
  const startedAt = Date.now();
  process.stdout.write(`… ${what}`);
  try {
    const result = await run();
    console.log(` ✔ ${Date.now() - startedAt}ms`);
    return result;
  } catch (error) {
    console.log(` ✖ ${Date.now() - startedAt}ms: ${error.message}`);
    throw error;
  }
};

const server = await startTraceServer();
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-x-'));
const { browser, page, downloads, cleanup } = await launchE2EBrowser({
  engine: process.argv[2] ?? 'puppeteer',
});
const commander = makeBrowserCommander({ page, downloads });

try {
  await step('goto first', () => page.goto(`${server.baseUrl}/`));
  const second = await step('newPage', () => browser.newPage());
  await step('goto second', () => second.goto(`${server.baseUrl}/`));
  const here = await step('startTrace here', () =>
    commander.startTrace({
      output: path.join(artifacts, 'here'),
      screenshots: false,
      mode: TRACE_MODE.CONTINUOUS,
    })
  );
  const there = await step('startTrace there', () =>
    startTrace({
      page: second,
      output: path.join(artifacts, 'there'),
      screenshots: false,
      mode: TRACE_MODE.CONTINUOUS,
    })
  );
  // Opening a second tab pushes the first into the background, where
  // requestAnimationFrame stops firing - and Puppeteer's click waits on it.
  await step('front here', () => page.bringToFront());
  await step('click here', () => page.click('#add'));
  await step('front there', () => second.bringToFront());
  await step('click there', () => second.click('#add'));
  await step('front here again', () => page.bringToFront());
  await step('touch the iframe', () =>
    commander.evaluate(() => {
      const framed = document.getElementById('inner').contentDocument;
      framed.body.appendChild(framed.createElement('span'));
    })
  );
  await step('checkpoint here', () => here.checkpoint('both pages moved'));
  await step('checkpoint there', () => there.checkpoint('both pages moved'));
  await step('stop here', () => here.stop());
  await step('stop there', () => there.stop());
  await step('close second', () => second.close());
} finally {
  await commander.destroy();
  await cleanup();
  await server.close();
  await fs.rm(artifacts, { recursive: true, force: true });
}
