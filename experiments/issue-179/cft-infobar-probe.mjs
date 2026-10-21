// Measure how much vertical space the browser chrome takes for several
// command lines (issue #179). A Chrome for Testing infobar adds ~40px.
// Usage: xvfb-run -a node experiments/issue-179/cft-infobar-probe.mjs <chrome> [out-dir]
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(
  new URL('../../js/package.json', import.meta.url)
);
const { chromium } = require('playwright');
const executable = process.argv[2];
const outDir = process.argv[3];
const variants = {
  none: [],
  'disable-infobars': ['--disable-infobars'],
  'test-type': ['--test-type'],
  'test-type=webdriver': ['--test-type=webdriver'],
  'test-type=gpu': ['--test-type=gpu'],
};
let port = 9400;
for (const [name, extra] of Object.entries(variants)) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cft-probe-'));
  port += 1;
  const child = spawn(
    executable,
    [
      `--user-data-dir=${dir}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--window-size=1000,800',
      ...(process.env.PROBE_ARGS ? process.env.PROBE_ARGS.split(' ') : []),
      ...extra,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  try {
    let browser;
    for (let i = 0; i < 100 && !browser; i++) {
      browser = await chromium
        .connectOverCDP(`http://127.0.0.1:${port}`)
        .catch(() => null);
      if (!browser) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const page = browser.contexts()[0].pages()[0];
    await new Promise((r) => setTimeout(r, 1500));
    const m = await page.evaluate(() => ({
      outer: globalThis.outerHeight,
      inner: globalThis.innerHeight,
      webdriver: globalThis.navigator.webdriver,
    }));
    console.log(
      JSON.stringify({ variant: name, chromeHeight: m.outer - m.inner, ...m })
    );
    if (outDir) {
      const s = await page.context().newCDPSession(page);
      await s.send('Page.navigate', {
        url: `data:text/html,<body style="background:%23cde">${name}`,
      });
    }
    await browser.close();
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    await rm(dir, { recursive: true, force: true });
  }
}
