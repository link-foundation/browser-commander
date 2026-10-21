// Does a screenshot taken while a headful window is resized leave the page
// drawn at its old size (issue #180)? Compares Playwright's clipped
// page.screenshot with the no-clip captureStableViewport.
// Run with DEBUG=pw:protocol to see the clip each capture sends.
// Usage: xvfb-run -a -s "-screen 0 1280x1024x24" \
//   node experiments/issue-180/resize-during-screenshot.mjs [chrome] [rounds]
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { captureStableViewport } from '../../js/src/capture/viewport.js';
import { startTrace } from '../../js/src/traces/recorder.js';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { chromium } = require('playwright');
const cache = path.join(os.homedir(), '.cache/ms-playwright');
const build = (await readdir(cache)).find((name) =>
  /^chromium-\d+$/.test(name)
);
const executable =
  process.argv[2] || path.join(cache, build, 'chrome-linux64/chrome');
const rounds = Number(process.argv[3] ?? 8);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const captures = {
  'page.screenshot': (page) => page.screenshot({ type: 'png' }),
  captureStableViewport: (page) =>
    captureStableViewport(page, 'playwright', { type: 'png' }),
  // The trace recorder's own checkpoint screenshots.
  'trace checkpoints': async (page) => {
    traces.set(
      page,
      traces.get(page) ??
        (await startTrace({
          page,
          output: path.join(os.tmpdir(), `issue-180-trace-${process.pid}`),
          mode: 'checkpoints',
          network: false,
          links: false,
        }))
    );
    await traces.get(page).checkpoint('resize');
  },
};
const traces = new Map();

let port = 9500;
for (const [name, capture] of Object.entries(captures)) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'issue-180-'));
  port += 1;
  const child = spawn(
    executable,
    [
      `--user-data-dir=${dir}`,
      `--remote-debugging-port=${port}`,
      '--no-sandbox',
      '--no-first-run',
      '--window-size=1000,800',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  try {
    let browser;
    for (let i = 0; i < 600 && !browser; i++) {
      browser = await chromium
        .connectOverCDP(`http://127.0.0.1:${port}`)
        .catch(() => null);
      if (!browser) {
        await sleep(100);
      }
    }
    const page = browser.contexts()[0].pages()[0];
    await page.setContent(
      '<body style="margin:0;background:linear-gradient(90deg,red,blue)">'
    );
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    const measure = () =>
      page.evaluate(() => ({
        inner: globalThis.innerWidth,
        outer: globalThis.outerWidth,
      }));
    await sleep(1000);
    const base = await measure();
    const frame = base.outer - base.inner;
    // Like the issue: keep capturing while each drag resizes the window in
    // 20 steps, then compare innerWidth with outerWidth.
    let stuck = 0;
    let failed = 0;
    let shots = 0;
    const samples = [];
    for (let drag = 0; drag < rounds; drag++) {
      let dragging = true;
      const loop = (async () => {
        while (dragging) {
          await capture(page).then(
            () => {
              shots += 1;
            },
            () => {
              failed += 1;
            }
          );
        }
      })();
      for (let step = 0; step < 20; step++) {
        const width = 700 + ((drag * 97 + step * 23) % 500);
        await cdp.send('Browser.setWindowBounds', {
          windowId,
          bounds: { width, windowState: 'normal' },
        });
        await sleep(15);
      }
      dragging = false;
      await loop;
      await sleep(400);
      const after = await measure();
      if (after.outer - after.inner !== frame) {
        stuck += 1;
        samples.push({ drag, ...after });
      }
    }
    const final = await measure();
    console.log(
      JSON.stringify({
        capture: name,
        drags: rounds,
        shots,
        failed,
        stuck,
        frame,
        final: { ...final, frame: final.outer - final.inner },
        samples: samples.slice(0, 5),
      })
    );
    await traces.get(page)?.stop();
    await browser.close().catch(() => {});
  } finally {
    child.kill();
    await sleep(300);
    await rm(dir, { recursive: true, force: true });
  }
}
