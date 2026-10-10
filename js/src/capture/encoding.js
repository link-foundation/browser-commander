import { writeCapture } from './files.js';
import fs from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import UPNG from 'upng-js';
import webp from 'webp-wasm';
import gifenc from 'gifenc';
import { UnsupportedCaptureError } from './errors.js';
const { GIFEncoder, quantize, applyPalette } = gifenc;

export function resizeFrame(frame, scale = 1, size) {
  const width = size?.width ?? Math.max(1, Math.round(frame.width * scale));
  const height = size?.height ?? Math.max(1, Math.round(frame.height * scale));
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 16_777_216
  ) {
    throw new RangeError(
      'capture dimensions must be positive integers within 16 megapixels'
    );
  }
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source =
        (Math.min(frame.height - 1, Math.floor((y * frame.height) / height)) *
          frame.width +
          Math.min(frame.width - 1, Math.floor((x * frame.width) / width))) *
        4;
      data.set(frame.data.subarray(source, source + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}
export function decodePng(bytes) {
  const data = Buffer.from(bytes);
  if (
    data.length < 33 ||
    !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new RangeError('frame must be a PNG');
  }
  const pixels = data.readUInt32BE(16) * data.readUInt32BE(20);
  if (pixels < 1 || pixels > 16_777_216) {
    throw new RangeError('PNG exceeds 16 megapixels');
  }
  const decoded = UPNG.decode(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.length)
  );
  return {
    width: decoded.width,
    height: decoded.height,
    data: new Uint8Array(UPNG.toRGBA8(decoded)[0]),
  };
}
export function encodePng(frame) {
  return Buffer.from(
    UPNG.encode(
      [
        frame.data.buffer.slice(
          frame.data.byteOffset,
          frame.data.byteOffset + frame.data.length
        ),
      ],
      frame.width,
      frame.height,
      0,
      undefined,
      true
    )
  );
}

function chunk(tag, data) {
  const header = Buffer.alloc(8);
  header.write(tag);
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([
    header,
    data,
    ...(data.length % 2 ? [Buffer.alloc(1)] : []),
  ]);
}
function write24(buffer, value, offset) {
  buffer.writeUIntLE(value, offset, 3);
}
async function animatedWebp(frames, { fps, quality = 75, loop = 0 }) {
  const { width, height } = frames[0];
  const extended = Buffer.alloc(10);
  extended[0] = 0x12;
  write24(extended, width - 1, 4);
  write24(extended, height - 1, 7);
  const animation = Buffer.alloc(6);
  animation.writeUInt16LE(loop, 4);
  const chunks = [chunk('VP8X', extended), chunk('ANIM', animation)];
  for (const frame of frames) {
    const encoded = await webp.encode(frame, { quality });
    const imageChunks = [];
    for (let offset = 12; offset < encoded.length;) {
      const length = encoded.readUInt32LE(offset + 4);
      const tag = encoded.subarray(offset, offset + 4).toString();
      if (['ALPH', 'VP8 ', 'VP8L'].includes(tag)) {
        imageChunks.push(
          encoded.subarray(offset, offset + 8 + length + (length % 2))
        );
      }
      offset += 8 + length + (length % 2);
    }
    const header = Buffer.alloc(16);
    write24(header, width - 1, 6);
    write24(header, height - 1, 9);
    write24(header, Math.round(1000 / fps), 12);
    header[15] = 2;
    chunks.push(chunk('ANMF', Buffer.concat([header, ...imageChunks])));
  }
  const payload = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const header = Buffer.alloc(8);
  header.write('RIFF');
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function pngChunk(tag, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(tag, 4);
  data.copy(bytes, 8);
  bytes.writeUInt32BE(
    UPNG.crc.crc(bytes, 4, data.length + 4) >>> 0,
    data.length + 8
  );
  return bytes;
}
function animatedPng(frames, fps, loop, optimize) {
  const { width, height } = frames[0];
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const animation = Buffer.alloc(8);
  animation.writeUInt32BE(frames.length);
  animation.writeUInt32BE(loop, 4);
  const chunks = [
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('acTL', animation),
  ];
  let sequence = 0;
  for (const [index, frame] of frames.entries()) {
    const control = Buffer.alloc(26);
    control.writeUInt32BE(sequence++);
    control.writeUInt32BE(width, 4);
    control.writeUInt32BE(height, 8);
    control.writeUInt16BE(Math.round(1000 / fps), 20);
    control.writeUInt16BE(1000, 22);
    chunks.push(pngChunk('fcTL', control));
    const scanlines = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) {
      scanlines.set(
        frame.data.subarray(y * width * 4, (y + 1) * width * 4),
        y * (width * 4 + 1) + 1
      );
    }
    const compressed = deflateSync(scanlines, { level: optimize ? 9 : 1 });
    if (index === 0) {
      chunks.push(pngChunk('IDAT', compressed));
    } else {
      const number = Buffer.alloc(4);
      number.writeUInt32BE(sequence++);
      chunks.push(pngChunk('fdAT', Buffer.concat([number, compressed])));
    }
  }
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}
function ditherPalette(frame, palette) {
  const data = Float32Array.from(frame.data);
  const pixels = new Uint8Array(frame.width * frame.height);
  const transparent = palette.findIndex((color) => color[3] === 0);
  const add = (x, y, channel, error, weight) => {
    if (x >= 0 && x < frame.width && y < frame.height) {
      data[(y * frame.width + x) * 4 + channel] += error * weight;
    }
  };
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const offset = (y * frame.width + x) * 4;
      if (data[offset + 3] < 128 && transparent >= 0) {
        pixels[y * frame.width + x] = transparent;
        continue;
      }
      let best = 0,
        distance = Infinity;
      for (let i = 0; i < palette.length; i++) {
        if (i === transparent) {
          continue;
        }
        const delta = palette[i]
          .slice(0, 3)
          .reduce((sum, value, c) => sum + (data[offset + c] - value) ** 2, 0);
        if (delta < distance) {
          distance = delta;
          best = i;
        }
      }
      pixels[y * frame.width + x] = best;
      for (let c = 0; c < 3; c++) {
        const error = data[offset + c] - palette[best][c];
        add(x + 1, y, c, error, 7 / 16);
        add(x - 1, y + 1, c, error, 3 / 16);
        add(x, y + 1, c, error, 5 / 16);
        add(x + 1, y + 1, c, error, 1 / 16);
      }
    }
  }
  return pixels;
}

/** Portable GIF/APNG/WebP animation from PNG bytes or paths. */
export async function encodeAnimation(input, options = {}) {
  const {
    format = 'gif',
    fps = 10,
    scale = 1,
    loop = 0,
    palette = 256,
    dither = false,
    optimize = true,
    path: output,
  } = options;
  validateAnimation(input, { fps, scale, loop, dither, format });
  const frames = [];
  let decodedBytes = 0;
  for (const value of input) {
    const png = typeof value === 'string' ? await fs.readFile(value) : value;
    const data = Buffer.from(png);
    if (data.length < 33) {
      throw new RangeError('frame must be a PNG');
    }
    const sourceBytes = data.readUInt32BE(16) * data.readUInt32BE(20) * 4;
    const targetBytes = options.size
      ? options.size.width * options.size.height * 4
      : sourceBytes * Math.max(1, scale * scale);
    if (decodedBytes + sourceBytes + targetBytes > 256 * 1024 * 1024) {
      throw new RangeError('decoded animation exceeds 256 MiB');
    }
    const frame = resizeFrame(decodePng(data), scale, options.size);
    decodedBytes += frame.data.length;
    frames.push(frame);
  }
  const { width, height } = frames[0];
  if (
    frames.some((frame) => frame.width !== width || frame.height !== height)
  ) {
    throw new RangeError('animation frames must have equal dimensions');
  }
  if (frames.length * width * height * 4 > 256 * 1024 * 1024) {
    throw new RangeError('decoded animation exceeds 256 MiB');
  }
  let bytes;
  if (format === 'gif') {
    bytes = encodeGif(frames, { width, height, palette, dither, fps, loop });
  } else if (format === 'apng') {
    bytes = animatedPng(frames, fps, loop, optimize);
  } else if (format === 'webp') {
    bytes = await animatedWebp(frames, { ...options, fps, loop });
  } else {
    throw new UnsupportedCaptureError(format, 'animation encoder');
  }
  if (bytes.length > 64 * 1024 * 1024) {
    throw new RangeError('encoded animation exceeds 64 MiB');
  }
  return writeCapture(bytes, output);
}

function validateAnimation(input, { fps, scale, loop, dither, format }) {
  if (
    !Number.isFinite(fps) ||
    fps < 1 ||
    fps > 60 ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    scale > 8
  ) {
    throw new RangeError('fps must be 1–60 and scale must be >0 and <=8');
  }
  if (!Number.isInteger(loop) || loop < 0 || loop > 65535) {
    throw new RangeError('loop must be 0–65535');
  }
  if (dither && format !== 'gif') {
    throw new UnsupportedCaptureError('dither', format);
  }
  if (!Array.isArray(input) || input.length === 0 || input.length > 1000) {
    throw new RangeError('animation requires 1–1000 frames');
  }
}
function encodeGif(frames, { width, height, palette, dither, fps, loop }) {
  if (
    !Array.isArray(palette) &&
    (!Number.isInteger(palette) || palette < 2 || palette > 256)
  ) {
    throw new RangeError('palette must be 2–256 colors or a palette array');
  }
  const gif = GIFEncoder();
  for (const frame of frames) {
    const colors = Array.isArray(palette)
      ? palette
      : quantize(frame.data, palette, { format: 'rgba4444' });
    const pixels = dither
      ? ditherPalette(frame, colors)
      : applyPalette(frame.data, colors, 'rgba4444');
    const transparentIndex = colors.findIndex((color) => color[3] === 0);
    gif.writeFrame(pixels, width, height, {
      palette: colors,
      delay: 1000 / fps,
      repeat: loop,
      dispose: 2,
      transparent: transparentIndex >= 0,
      transparentIndex: Math.max(0, transparentIndex),
    });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}
