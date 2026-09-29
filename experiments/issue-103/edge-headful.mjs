/**
 * Reproduce net::ERR_INSUFFICIENT_RESOURCES on headful Microsoft Edge after the
 * real launch: list the tabs Edge opened, try a navigation, take a screenshot.
 *
 *   xvfb-run -a node experiments/issue-103/edge-headful.mjs [executablePath]
 */
import { createServer } from 'node:http';
import { launchBrowser } from '../../js/src/index.js';

const executablePath = process.argv[2] || '/usr/bin/microsoft-edge';
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<title>ok</title><p>ok</p>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const session = await launchBrowser({
  engine: 'playwright',
  executablePath,
  verbose: process.env.VERBOSE === '1',
});
const started = Date.now();
const stamp = (label) => console.log(`[+${Date.now() - started}ms] ${label}`);
session.connectedBrowser?.on('disconnected', () => stamp('DISCONNECTED'));
session.page.on('crash', () => stamp('PAGE CRASH'));
session.page.on('close', () => stamp('PAGE CLOSE'));
session.browserProcess?.once?.('exit', (code) => stamp(`EDGE EXIT ${code}`));
try {
  const pages = session.browser.pages() ?? [];
  console.log('args', session.args);
  console.log(
    'open pages',
    pages.map((page) => page.url())
  );
  await new Promise((resolve) => setTimeout(resolve, 3000));
  console.log(
    'open pages after 3s',
    (session.browser.pages() ?? []).map((page) => page.url())
  );
  try {
    await session.page.goto(url, { waitUntil: 'load' });
    console.log('goto ok', await session.page.title());
  } catch (error) {
    console.log('goto failed', error.message.split('\n')[0]);
  }
  await session.page
    .screenshot({ path: '/tmp/edge-headful.png' })
    .catch((e) => console.log('shot', e.message));
  const other = await session.page.context().newPage();
  try {
    await other.goto(url, { waitUntil: 'load' });
    console.log('new tab goto ok', await other.title());
  } catch (error) {
    console.log('new tab goto failed', error.message.split('\n')[0]);
  }
} finally {
  await session.browser.close();
  server.close();
}
