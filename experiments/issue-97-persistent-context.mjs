/**
 * Show which Browser.setDownloadBehavior / Target.createTarget context pairing
 * produces download events from a Playwright persistent context (issue #97).
 *
 * Run from the repository root with:
 *   CHROME_NO_SANDBOX=true node experiments/issue-97-persistent-context.mjs
 */
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromJs = createRequire(
  new URL('../js/package.json', import.meta.url)
);
const { chromium } = requireFromJs('playwright');

const server = http.createServer((_request, response) => {
  response.writeHead(200, {
    'content-disposition': 'attachment; filename="context.txt"',
    'content-type': 'text/plain',
  });
  response.end('context body');
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-context-profile-'));
const downloads = await fs.mkdtemp(
  path.join(os.tmpdir(), 'bc-context-downloads-')
);
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  args: process.env.CHROME_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
});
const page = context.pages()[0];
const pageSession = await context.newCDPSession(page);
const browserSession = await context.browser().newBrowserCDPSession();
const { targetInfo } = await pageSession.send('Target.getTargetInfo');
const { browserContextIds } = await browserSession.send(
  'Target.getBrowserContexts'
);

browserSession.on('Browser.downloadWillBegin', (event) => {
  console.log('downloadWillBegin', event);
});
browserSession.on('Browser.downloadProgress', (event) => {
  console.log('downloadProgress', event);
});

console.log('persistent context has browser:', Boolean(context.browser()));
console.log('target browserContextId:', targetInfo.browserContextId);
console.log('non-default browserContextIds:', browserContextIds);
await browserSession.send('Browser.setDownloadBehavior', {
  behavior: 'allowAndName',
  downloadPath: downloads,
  eventsEnabled: true,
});
const address = server.address();
await browserSession.send('Target.createTarget', {
  url: `http://127.0.0.1:${address.port}/context.txt`,
});
await new Promise((resolve) => setTimeout(resolve, 2000));
console.log('staged files:', await fs.readdir(downloads));

await context.close();
server.close();
await once(server, 'close');
await fs.rm(profile, { recursive: true, force: true });
await fs.rm(downloads, { recursive: true, force: true });
