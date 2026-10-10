import assert from 'node:assert/strict';
import readline from 'node:readline';
import { chromium } from '../../js/node_modules/playwright/index.mjs';
import { screenshot } from '../../js/src/capture/index.js';
import { decodePng } from '../../js/src/capture/encoding.js';

const browser = await chromium.launch({
  headless: false,
  executablePath: process.env.CHROME_PATH,
  args: ['--no-sandbox', '--window-position=0,0', '--window-size=800,650'],
});
const input = readline.createInterface({ input: process.stdin });
try {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.setContent(`<style>
    html{scroll-behavior:smooth}body{margin:0;font:24px sans-serif;background:#e5eefb}
    section{height:350px;padding:20px;box-sizing:border-box}
    section:nth-child(even){background:#abc6ef}
  </style><title>Stable viewport regression</title>${Array.from({ length: 18 }, (_, i) => `<section>Product pager ${i}</section>`).join('')}`);
  await page.evaluate(async () => {
    window.scrollTo({ top: 4081, behavior: 'smooth' });
    await new Promise((resolve) => {
      const check = () =>
        window.scrollY === 4081
          ? resolve()
          : window.requestAnimationFrame(check);
      check();
    });
  });
  await page.waitForTimeout(500);
  const geometry = () => ({
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight,
    pageTop: window.visualViewport.pageTop,
    visualHeight: window.visualViewport.height,
    ratio: window.devicePixelRatio,
  });
  const before = await page.evaluate(geometry);
  console.log(JSON.stringify({ ready: true, geometry: before }));
  for await (const line of input) {
    if (line === 'capture') {
      await page.evaluate((source) => {
        const read = new Function(`return (${source})`)();
        window.captureGeometry = [];
        window.captureSampling = true;
        const sample = () => {
          window.captureGeometry.push(read());
          if (window.captureSampling && window.captureGeometry.length < 300) {
            window.requestAnimationFrame(sample);
          }
        };
        sample();
      }, geometry.toString());
      for (let i = 0; i < 4; i++) {
        const png = decodePng(await screenshot({ page, stableViewport: true }));
        assert.equal(png.width, Math.round(before.width * before.ratio));
        assert.equal(png.height, Math.round(before.height * before.ratio));
      }
      console.log(JSON.stringify({ captured: true }));
    } else if (line === 'stop') {
      const samples = await page.evaluate(() => {
        window.captureSampling = false;
        return window.captureGeometry;
      });
      assert.ok(samples.length > 1);
      for (const sample of samples) {
        assert.deepEqual(sample, before);
      }
      console.log(
        JSON.stringify({
          geometrySamples: samples.length,
          geometryUnchanged: true,
        })
      );
      break;
    }
  }
} finally {
  input.close();
  await browser.close();
}
