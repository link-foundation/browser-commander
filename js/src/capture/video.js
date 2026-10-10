import { writeCapture } from './files.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from '../utilities/subprocess.js';
import { decodePng } from './encoding.js';
import { UnsupportedCaptureError } from './errors.js';

/** Optional binary backend; never inferred from PATH or invoked by default. */
export async function encodeVideo(frames, options = {}) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 1000) {
    throw new RangeError('video requires 1–1000 frames');
  }
  if (
    !Number.isFinite(options.fps ?? 10) ||
    (options.fps ?? 10) < 1 ||
    (options.fps ?? 10) > 60
  ) {
    throw new RangeError('fps must be 1–60');
  }
  if (
    options.quality !== undefined &&
    (!Number.isInteger(options.quality) ||
      options.quality < 0 ||
      options.quality > 100)
  ) {
    throw new RangeError('quality must be 0–100');
  }
  if (frames.reduce((sum, frame) => sum + frame.length, 0) > 64 * 1024 * 1024) {
    throw new RangeError('video frames exceed 64 MiB');
  }
  for (const frame of frames) {
    decodePng(frame);
  }
  if (!options.ffmpeg) {
    if (!options.page?.evaluate) {
      throw new UnsupportedCaptureError(
        options.format ?? 'webm',
        'video encoder (provide a page or set ffmpeg explicitly)'
      );
    }
    const result = await options.page.evaluate(encodeVideoInPage, {
      frames: frames.map((frame) => frame.toString('base64')),
      format: options.format ?? 'webm',
      fps: options.fps ?? 10,
      quality: options.quality,
      size: options.size,
    });
    if (result.unsupported) {
      throw new UnsupportedCaptureError(
        options.format ?? 'webm',
        options.engine ?? 'MediaRecorder'
      );
    }
    const bytes = Buffer.from(result.data);
    return writeCapture(bytes, options.path);
  }
  return encodeFfmpeg(frames, options);
}

async function encodeFfmpeg(frames, options) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'commander-video-')
  );
  try {
    for (let i = 0; i < frames.length; i++) {
      await fs.writeFile(
        path.join(directory, `${String(i).padStart(6, '0')}.png`),
        frames[i]
      );
    }
    const output = path.join(directory, `output.${options.format ?? 'webm'}`);
    const codec = { mp4: 'libx264', webm: 'libvpx-vp9', mov: 'libx264' }[
      options.format ?? 'webm'
    ];
    if (!codec) {
      throw new UnsupportedCaptureError(options.format, 'ffmpeg');
    }
    const args = [
      '-y',
      '-framerate',
      String(options.fps ?? 10),
      '-i',
      path.join(directory, '%06d.png'),
      '-c:v',
      codec,
      '-pix_fmt',
      'yuv420p',
      '-crf',
      String(Math.round(51 * (1 - (options.quality ?? 75) / 100))),
      ...(options.size
        ? ['-vf', `scale=${options.size.width}:${options.size.height}`]
        : []),
      output,
    ];
    try {
      await runCommand(
        options.ffmpeg === true ? 'ffmpeg' : options.ffmpeg,
        args
      );
    } catch (cause) {
      throw new UnsupportedCaptureError('ffmpeg', 'video encoder', cause);
    }
    const bytes = await fs.readFile(output);
    return writeCapture(bytes, options.path);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

/** Browser-native encoding on a detached canvas; no live DOM markers. */
export async function encodeVideoInPage({
  frames,
  format,
  fps,
  quality,
  size,
}) {
  const mimeType = { webm: 'video/webm', mp4: 'video/mp4' }[format];
  if (!mimeType || !globalThis.MediaRecorder?.isTypeSupported(mimeType)) {
    return { unsupported: true };
  }
  const image = new globalThis.Image();
  image.src = `data:image/png;base64,${frames[0]}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = size?.width ?? image.width;
  canvas.height = size?.height ?? image.height;
  if (
    !Number.isInteger(canvas.width) ||
    canvas.width < 1 ||
    !Number.isInteger(canvas.height) ||
    canvas.height < 1 ||
    canvas.width * canvas.height > 16_777_216
  ) {
    throw new RangeError('video canvas exceeds 16 megapixels');
  }
  const context = canvas.getContext('2d');
  const stream = canvas.captureStream(fps);
  const chunks = [];
  let encodedBytes = 0;
  const recorder = new globalThis.MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: Math.max(
      100_000,
      Math.round((quality ?? 75) * 100_000)
    ),
  });
  const done = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      encodedBytes += event.data.size;
      if (encodedBytes > 64 * 1024 * 1024) {
        reject(new RangeError('encoded video exceeds 64 MiB'));
      } else {
        chunks.push(event.data);
      }
    };
    recorder.onerror = (event) =>
      reject(event.error ?? new Error('Video encoding failed'));
    recorder.onstop = resolve;
  });
  // Keep early codec failures handled while frames are still being decoded.
  done.catch(() => {});
  try {
    recorder.start();
    for (const bytes of frames) {
      image.src = `data:image/png;base64,${bytes}`;
      await image.decode();
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      await new Promise((resolve) => setTimeout(resolve, 1000 / fps));
    }
    recorder.stop();
    await done;
    return {
      data: Array.from(
        new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer())
      ),
    };
  } finally {
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    stream.getTracks().forEach((track) => track.stop());
  }
}
