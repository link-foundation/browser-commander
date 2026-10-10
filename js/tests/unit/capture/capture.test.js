import { it } from 'node:test';
import assert from 'node:assert/strict';
import UPNG from 'upng-js';
import {
  screenshot,
  encodeAnimation,
  UnsupportedCaptureError,
} from '../../../src/capture/index.js';

const png = (color) =>
  Buffer.from(
    UPNG.encode([new Uint8Array(color).buffer], 1, 1, 0, undefined, true)
  );
it('screenshots honor WebP format without handing unsupported options to the engine', async () => {
  const page = {
    screenshot: async (options) => {
      assert.equal(options.type, 'png');
      return png([255, 0, 0, 255]);
    },
  };
  const result = await screenshot({
    page,
    engine: 'playwright',
    format: 'webp',
    quality: 80,
  });
  assert.equal(result.subarray(8, 12).toString(), 'WEBP');
});
it('animation encoders produce multiple frames with no external binary', async () => {
  const frames = [png([255, 0, 0, 255]), png([0, 0, 255, 255])];
  assert.equal(
    (await encodeAnimation(frames, { format: 'gif', fps: 5 }))
      .subarray(0, 6)
      .toString(),
    'GIF89a'
  );
  const apng = await encodeAnimation(frames, { format: 'apng', fps: 5 });
  assert.equal(
    UPNG.decode(
      apng.buffer.slice(apng.byteOffset, apng.byteOffset + apng.length)
    ).frames.length,
    2
  );
  const webp = await encodeAnimation(frames, { format: 'webp', fps: 5 });
  assert.equal(webp.toString('latin1').split('ANMF').length - 1, 2);
});
it('rejects unsupported options with a typed capability error', async () => {
  await assert.rejects(
    screenshot({ page: {}, engine: 'unknown' }),
    UnsupportedCaptureError
  );
});
