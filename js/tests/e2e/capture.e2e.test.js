/** Real launch and capture contracts for the Command Stream upgrade (#164). */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import UPNG from 'upng-js';
import {
  screenshot,
  startRecording,
  encodeAnimation,
  encodeVideo,
  launchBrowser,
} from '../../src/index.js';
import { CHROME_LAUNCH_OPTIONS } from '../helpers/e2e-browser.js';

for (const engine of ['playwright', 'puppeteer', 'selenium']) {
  it(
    `${engine}: screenshots and bounded animation/video capture after a real launch`,
    { skip: !process.env.RUN_E2E, timeout: 60000 },
    async () => {
      const session = await launchBrowser({
        engine,
        headless: process.env.HEADLESS !== 'false',
        ...CHROME_LAUNCH_OPTIONS,
        ...(engine === 'selenium' ? { bidi: true } : {}),
      });
      let recording;
      try {
        const { page } = session;
        await page.goto(
          'data:text/html,<input id="focus"><div style="height:2000px;background:teal">Capture fixture</div>'
        );
        const state = () =>
          page.evaluate(() => ({
            scroll: window.scrollY,
            active: document.activeElement.id,
          }));
        await page.evaluate(() => {
          document.querySelector('input').focus();
          window.scrollTo(0, 200);
        });
        const before = await state();
        const png = await screenshot({ page, engine, stableViewport: true });
        assert.equal(png.subarray(1, 4).toString(), 'PNG');
        assert.deepEqual(await state(), before);
        const jpeg = await screenshot({ page, engine, format: 'jpeg' });
        assert.equal(jpeg.readUInt16BE(0), 0xffd8);
        const webp = await screenshot({ page, engine, format: 'webp' });
        assert.equal(webp.subarray(8, 12).toString(), 'WEBP');

        recording = await startRecording({
          page,
          engine,
          format: 'frames',
          fps: 2,
          maxFrames: 2,
          maxBytes: 1024 * 1024,
          maxDurationMs: 3000,
          size: { width: 120, height: 100 },
        });
        await page.evaluate(() => {
          document.querySelector('div').style.background = 'red';
        });
        const deadline = Date.now() + 3000;
        while (recording.frames.length < 2 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const { frames } = await recording.stop();
        assert.equal(frames.length, 2);
        const gif = await encodeAnimation(frames, { format: 'gif', fps: 2 });
        assert.equal(gif.subarray(0, 6).toString(), 'GIF89a');
        const apng = await encodeAnimation(frames, { format: 'apng', fps: 2 });
        assert.equal(UPNG.decode(apng).frames.length, 2);
        const animatedWebp = await encodeAnimation(frames, {
          format: 'webp',
          fps: 2,
        });
        assert.equal(
          animatedWebp.toString('latin1').split('ANMF').length - 1,
          2
        );
        const video = await encodeVideo(frames, {
          page,
          engine,
          format: 'webm',
          fps: 2,
        });
        assert.equal(video.readUInt32BE(0), 0x1a45dfa3);
      } finally {
        try {
          await recording?.stop();
        } finally {
          await session.close();
        }
      }
    }
  );
}
