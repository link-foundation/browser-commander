import { writeCapture } from '../capture/files.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readTrace } from './reader.js';
import {
  encodeAnimation,
  decodePng,
  encodePng,
  resizeFrame,
} from '../capture/encoding.js';
import { encodeVideo } from '../capture/video.js';

export function withinTime(record, options = {}) {
  const time = (value) =>
    typeof value === 'number' || /^\d+(\.\d+)?$/.test(value)
      ? { offset: Number(value) * 1000 }
      : {
          date: Date.parse(
            /^\d{2}:\d{2}(?::\d{2})?$/.test(value)
              ? `${options.startedAt?.slice(0, 10)}T${value.length === 5 ? `${value}:00` : value}Z`
              : value
          ),
        };
  for (const [name, direction] of [
    ['from', -1],
    ['to', 1],
  ]) {
    if (options[name] === undefined) {
      continue;
    }
    const bound = time(options[name]);
    if (bound.date !== undefined && !Number.isFinite(bound.date)) {
      throw new RangeError(`invalid ${name} timestamp`);
    }
    const value =
      bound.offset !== undefined
        ? (record.monotonicMs ?? 0) - (options.monotonicOrigin ?? 0)
        : Date.parse(record.at);
    if (
      direction === -1
        ? value < (bound.offset ?? bound.date)
        : value > (bound.offset ?? bound.date)
    ) {
      return false;
    }
  }
  return true;
}
export async function summarizeTrace(root, options = {}) {
  const opened = await readTrace(root);
  options = timelineOptions(opened, options);
  const records = [...opened.events];
  const seenMutations = new Set();
  for (const event of opened.events.filter(
    (event) => event.kind === 'mutations'
  )) {
    const key = `${event.segment ?? ''}:${event.checkpoint}`;
    if (seenMutations.has(key)) {
      continue;
    }
    seenMutations.add(key);
    for (const batch of await opened.mutations(event.checkpoint)) {
      for (const mutation of batch.records ?? []) {
        records.push({
          ...mutation,
          kind: `dom.${mutation.kind}`,
          at: new Date(batch.at).toISOString(),
          monotonicMs: event.monotonicMs,
        });
      }
    }
  }
  return records
    .filter(
      (record) =>
        withinTime(record, options) &&
        (!options.grep || JSON.stringify(record).includes(options.grep))
    )
    .sort(
      (a, b) =>
        Date.parse(a.at) - Date.parse(b.at) ||
        (a.sequence ?? 0) - (b.sequence ?? 0)
    );
}
export async function renderTrace(root, options = {}) {
  const opened = await readTrace(root);
  options = timelineOptions(opened, options);
  const frames = [];
  let compressedBytes = 0;
  for (const event of opened.events.filter(
    (event) => event.kind === 'checkpoint' && withinTime(event, options)
  )) {
    const member = event.members?.screenshot;
    if (member) {
      if (frames.length >= 1000) {
        throw new RangeError('trace render exceeds 1000 frames');
      }
      const file = path.join(opened.path, member);
      compressedBytes += (await fs.stat(file)).size;
      if (compressedBytes > 64 * 1024 * 1024) {
        throw new RangeError('trace render frames exceed 64 MiB');
      }
      frames.push(await fs.readFile(file));
    }
  }
  if (frames.length === 0) {
    throw new Error('trace has no checkpoint screenshots in this interval');
  }
  if (frames.length > 1000) {
    throw new RangeError('trace render exceeds 1000 frames');
  }
  const format =
    options.format ?? (path.extname(options.path ?? '').slice(1) || 'gif');
  if (format === 'sheet') {
    let total = 0;
    const images = frames.map((frame) => {
      if (frame.length < 33) {
        throw new RangeError('frame must be a PNG');
      }
      total +=
        frame.readUInt32BE(16) *
        frame.readUInt32BE(20) *
        4 *
        Math.max(1, (options.scale ?? 1) ** 2);
      if (total > 256 * 1024 * 1024) {
        throw new RangeError('contact sheet frames exceed 256 MiB');
      }
      return resizeFrame(decodePng(frame), options.scale ?? 1);
    });
    const columns = options.columns ?? Math.min(4, images.length);
    if (!Number.isInteger(columns) || columns < 1 || columns > 1000) {
      throw new RangeError('columns must be 1–1000');
    }
    const width = Math.max(...images.map((image) => image.width)) * columns;
    const rowHeight = Math.max(...images.map((image) => image.height));
    const height = rowHeight * Math.ceil(images.length / columns);
    if (width * height > 16_777_216) {
      throw new RangeError('contact sheet exceeds 16 megapixels');
    }
    const data = new Uint8Array(width * height * 4);
    images.forEach((image, index) => {
      const x = (index % columns) * (width / columns),
        y = Math.floor(index / columns) * rowHeight;
      for (let row = 0; row < image.height; row++) {
        data.set(
          image.data.subarray(
            row * image.width * 4,
            (row + 1) * image.width * 4
          ),
          ((y + row) * width + x) * 4
        );
      }
    });
    const bytes = encodePng({ width, height, data });
    return writeCapture(bytes, options.path);
  }
  return ['mp4', 'webm', 'mov'].includes(format)
    ? encodeVideo(frames, { ...options, format })
    : encodeAnimation(frames, { ...options, format });
}

function timelineOptions(opened, options) {
  return {
    ...options,
    monotonicOrigin: opened.events[0]?.monotonicMs ?? 0,
    startedAt: opened.events[0]?.at,
  };
}
