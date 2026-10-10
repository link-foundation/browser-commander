import { setTimeout as delay } from 'node:timers/promises';
import { screenshot } from './screenshot.js';
import {
  encodeAnimation,
  decodePng,
  encodePng,
  resizeFrame,
} from './encoding.js';
import { encodeVideo } from './video.js';
import { UnsupportedCaptureError } from './errors.js';

/** A bounded, sequential screenshot recorder, usable on attached sessions. */
export async function startRecording(options = {}) {
  options = { ...options, path: options.path ?? options.output };
  const {
    fps = 10,
    maxFrames = 1000,
    maxBytes = 64 * 1024 * 1024,
    maxDurationMs = 60_000,
    format = 'webm',
  } = options;
  if (
    !Number.isFinite(fps) ||
    fps < 1 ||
    fps > 60 ||
    !Number.isSafeInteger(maxFrames) ||
    maxFrames < 1 ||
    maxFrames > 1000 ||
    !Number.isFinite(maxDurationMs) ||
    maxDurationMs <= 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1
  ) {
    throw new RangeError('invalid recording bounds');
  }
  if (
    !['frames', 'gif', 'apng', 'webp', 'webm', 'mp4', 'mov'].includes(format)
  ) {
    throw new UnsupportedCaptureError(format, options.engine);
  }
  if (['webm', 'mp4', 'mov'].includes(format) && !options.ffmpeg) {
    const supported = await options.page.evaluate(
      (format) =>
        globalThis.MediaRecorder?.isTypeSupported(
          { webm: 'video/webm', mp4: 'video/mp4' }[format] ?? ''
        ) ?? false,
      format
    );
    if (!supported) {
      throw new UnsupportedCaptureError(
        format,
        options.engine ?? 'MediaRecorder'
      );
    }
  }
  const frames = [];
  const controller = new AbortController();
  let bytes = 0,
    failure,
    stopping,
    truncated = false;
  const started = performance.now();
  const grab = async () => {
    let data = await screenshot({
      page: options.page,
      engine: options.engine,
      ...(options.screenshot ?? {}),
      format: 'png',
    });
    if (options.size) {
      data = encodePng(resizeFrame(decodePng(data), 1, options.size));
    }
    if (bytes + data.length > maxBytes) {
      truncated = true;
      return false;
    }
    frames.push(data);
    bytes += data.length;
    return true;
  };
  if (!(await grab())) {
    throw new RangeError('The first recording frame exceeds maxBytes');
  }
  const task = (async () => {
    while (!controller.signal.aborted) {
      try {
        await delay(Math.max(1, 1000 / fps), undefined, {
          signal: controller.signal,
        });
      } catch {
        break;
      }
      if (
        frames.length >= maxFrames ||
        performance.now() - started >= maxDurationMs
      ) {
        truncated = true;
        break;
      }
      try {
        if (!(await grab())) {
          break;
        }
      } catch (error) {
        failure = error;
        break;
      }
    }
  })();
  const stop = (stopOptions = {}) => {
    stopping ??= (async () => {
      controller.abort();
      await task;
      if (failure) {
        throw failure;
      }
      const encoding = { ...options, format, ...stopOptions, fps };
      const data =
        encoding.format === 'frames'
          ? null
          : ['gif', 'apng', 'webp'].includes(encoding.format)
            ? await encodeAnimation(frames, encoding)
            : await encodeVideo(frames, encoding);
      return {
        frames,
        bytes: data,
        path: encoding.path ?? null,
        format: encoding.format,
        fps,
        truncated,
      };
    })();
    return stopping;
  };
  return { stop, frames, fps };
}
