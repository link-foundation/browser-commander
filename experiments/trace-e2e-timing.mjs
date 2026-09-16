/**
 * Where does the trace e2e suite spend its time? (issue #87)
 *
 * The suite's first runs took 30-80 seconds per test, which is not the cost
 * of a click. This times each step against a real browser so the slow one is
 * a measurement rather than a guess.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { makeBrowserCommander } from '../js/src/factory.js';
import { launchBrowser } from '../js/src/browser/launcher.js';
import { startTraceServer } from '../js/tests/helpers/trace-server.js';

const engine = process.argv[2] ?? 'playwright';

const time = async (what, work) => {
  const started = Date.now();
  const result = await work();
  console.log(`${String(Date.now() - started).padStart(6)}ms  ${what}`);
  return result;
};

const server = await startTraceServer();
const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-timing-'));
const output = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-timing-trace-'));
const { browser, page, downloads } = await launchBrowser({
  engine,
  userDataDir,
  headless: true,
  slowMo: 0,
  args: ['--no-sandbox'],
  downloads: { directory: userDataDir },
});
const commander = makeBrowserCommander({ page, downloads });

await time('goto', () => page.goto(`${server.baseUrl}/`));
const trace = await time('startTrace', () =>
  commander.startTrace({ output: path.join(output, 'run'), screenshots: false })
);
await time('fill (defaults)', () =>
  commander.fill({ selector: '#name', text: 'ada' })
);
await time('click (defaults)', () => commander.click({ selector: '#add' }));
await time('click (no nav wait, no settle)', () =>
  commander.click({
    selector: '#add',
    waitForNavigation: false,
    waitAfterClick: 0,
  })
);
await time('page.click', () => page.click('#add'));
await time('checkpoint', () => trace.checkpoint('timed'));
await time('checkpoint + screenshot', () =>
  trace.checkpoint('timed with a picture', { screenshots: true })
);
await time('stop', () => trace.stop());

await commander.destroy();
await browser.close();
await server.close();
await fs.rm(userDataDir, { recursive: true, force: true });
await fs.rm(output, { recursive: true, force: true });
