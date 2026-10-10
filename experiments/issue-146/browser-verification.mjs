import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { chromium } from '../../js/node_modules/playwright/index.mjs';
import {
  screenshot,
  startRecording,
  encodeAnimation,
} from '../../js/src/capture/index.js';
import {
  connectOrLaunch,
  probeSession,
} from '../../js/src/browser/persistent-session.js';
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  await page.setContent(
    '<style>body{background:#eef3fa;font:20px sans-serif;padding:20px}button{background:#265cf0;color:white;border:0;padding:14px;border-radius:8px}input{width:200px} @keyframes pulse{to{opacity:.5}}</style><button>Capture demo</button><p>Clean page capture</p><input value="caret">'
  );
  const before = await page.locator('body').evaluate((el) => el.innerHTML);
  await fs.mkdir('docs/screenshots', { recursive: true });
  const png = await screenshot({
    page,
    engine: 'playwright',
    hideScrollbars: true,
    hideCaret: true,
    disableAnimations: true,
    waitForFonts: true,
    path: 'docs/screenshots/issue-146-capture.png',
  });
  assert.equal(
    await page.locator('body').evaluate((el) => el.innerHTML),
    before
  );
  const frames = [png];
  await page
    .locator('button')
    .evaluate((el) => (el.style.background = '#ba275e'));
  frames.push(await screenshot({ page, engine: 'playwright' }));
  for (const format of ['gif', 'apng', 'webp']) {
    const bytes = await encodeAnimation(frames, {
      format,
      fps: 5,
      path: `docs/screenshots/issue-146.${format}`,
    });
    const decoded = await page.evaluate(
      async ({ format, data }) => {
        const image = new globalThis.Image();
        image.src = `data:image/${format === 'apng' ? 'png' : format};base64,${data}`;
        await image.decode();
        return { width: image.width, height: image.height };
      },
      { format, data: bytes.toString('base64') }
    );
    assert.equal(decoded.width, 320);
    console.log(format, bytes.length, decoded);
  }
  for (const format of ['webm', 'mp4']) {
    const recorder = await startRecording({
      page,
      engine: 'playwright',
      format,
      fps: 10,
      maxFrames: 3,
    });
    await new Promise((r) => setTimeout(r, 250));
    const result = await recorder.stop();
    const metadata = await page.evaluate(
      async ({ data, format }) => {
        const video = document.createElement('video');
        video.src = `data:video/${format};base64,${data}`;
        await new Promise((res, rej) => {
          video.onloadedmetadata = res;
          video.onerror = () => rej(new Error(video.error?.message));
        });
        return { width: video.videoWidth, height: video.videoHeight };
      },
      { data: result.bytes.toString('base64'), format }
    );
    assert.equal(metadata.width, 320);
    console.log(format, result.bytes.length, metadata);
  }
} finally {
  await browser.close();
}
const server = net.createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise((r) => server.close(r));
const profile = await fs.mkdtemp(
  path.join(os.tmpdir(), 'commander-persistent-')
);
let session;
try {
  const options = {
    userDataDir: profile,
    remoteDebuggingPort: port,
    idleTimeoutMs: 3000,
    headless: true,
    executablePath: chromium.executablePath(),
    args: ['--no-sandbox'],
  };
  session = await connectOrLaunch(options);
  await session.page.goto('data:text/html,<p>remembered tab</p>');
  await session.detach();
  assert.ok(await probeSession(session.cdpEndpoint));
  session = await connectOrLaunch(options);
  assert.equal(session.reused, true);
  assert.match(session.page.url(), /remembered/);
  console.log('persistent reconnect', session.page.url());
  await session.detach();
  for (let i = 0; i < 80 && (await probeSession(session.cdpEndpoint)); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await probeSession(session.cdpEndpoint), null);
  console.log('idle watchdog closed browser');
} catch (error) {
  console.error('Persistent session failure', error);
  throw error;
} finally {
  await session?.close();
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
