import fs from 'node:fs/promises';
import path from 'node:path';
import { openTraceBundle } from './bundle.js';
import { createManifest } from './schema.js';

/** Rotate complete bundles at the producer's write boundary, including background events. */
export async function openRollingBundle(options, config, traceOptions) {
  const root = path.resolve(options.output);
  const maxBytes =
    config.maxBytes ?? options.limits.maxBundleBytes ?? 32 * 1024 * 1024;
  const maxSegments = config.maxSegments ?? Infinity;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1024 ||
    (maxSegments !== Infinity &&
      (!Number.isSafeInteger(maxSegments) ||
        maxSegments < 1 ||
        maxSegments > 100))
  ) {
    throw new RangeError('invalid trace rotation bounds');
  }
  let current,
    sequence = 0,
    pinned = false,
    base = null,
    baseEvent = null;
  let eventSequence = 0;
  const segments = [],
    writers = [];
  let queue = Promise.resolve();
  const run = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const template = () =>
    createManifest({
      mode: traceOptions.mode ?? 'checkpoints',
      engine: traceOptions.commander?.engine,
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
      dom: traceOptions.dom,
      limits: traceOptions.limits,
    });
  async function open() {
    const name = `segment-${String(++sequence).padStart(6, '0')}`;
    current = await openTraceBundle({
      ...options,
      output: path.join(root, name),
      nextSequence: () => ++eventSequence,
      limits: { ...options.limits, maxBundleBytes: Infinity },
      onEvent: (event) => options.onEvent?.(event, { root: current.root }),
    });
    writers.push(current);
    segments.push(name);
    if (segments.length > maxSegments) {
      await fs.rm(path.join(root, segments.shift()), {
        recursive: true,
        force: true,
      });
    }
    await fs.writeFile(
      path.join(root, 'segments.json.tmp'),
      JSON.stringify({ segments }),
      { mode: 0o600 }
    );
    await fs.rename(
      path.join(root, 'segments.json.tmp'),
      path.join(root, 'segments.json')
    );
  }
  async function prepare(bytes, carry = false) {
    if (
      !pinned &&
      current.bytesWritten > 0 &&
      current.bytesWritten + bytes > maxBytes
    ) {
      await current.close(template());
      if (sequence === 0) {
        const name = 'segment-000001';
        const destination = path.join(root, name);
        await fs.mkdir(destination, { mode: 0o700 });
        for (const member of [
          'events.ndjson',
          'manifest.json',
          'checkpoints',
          'mutations',
          'artifacts',
          'viewer.html',
        ]) {
          await fs
            .rename(path.join(root, member), path.join(destination, member))
            .catch((error) => {
              if (error.code !== 'ENOENT') {
                throw error;
              }
            });
        }
        sequence = 1;
        segments.push(name);
      }
      await open();
      if (carry && base && baseEvent) {
        const members = await current.writeCheckpoint(base);
        await current.appendEvent({
          ...baseEvent,
          members,
          reason: 'rotation-base',
        });
      }
    }
  }
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if (config.lazy) {
    current = await openTraceBundle({
      ...options,
      nextSequence: () => ++eventSequence,
      limits: { ...options.limits, maxBundleBytes: Infinity },
    });
    writers.push(current);
  } else {
    await open();
  }
  const counts = () =>
    writers.reduce(
      (sum, b) => {
        for (const k of Object.keys(sum)) {
          sum[k] += b.counts[k];
        }
        return sum;
      },
      { checkpoints: 0, events: 0, mutationBatches: 0 }
    );
  return {
    root,
    get currentPath() {
      return current.root;
    },
    get segments() {
      return [...segments];
    },
    get counts() {
      return counts();
    },
    get problems() {
      return writers.flatMap((b) => b.problems);
    },
    get dropped() {
      return writers.reduce((sum, b) => sum + b.dropped, 0);
    },
    get bytesWritten() {
      return current.bytesWritten;
    },
    get mutationTruncated() {
      return current.mutationTruncated;
    },
    appendEvent: (event) =>
      run(async () => {
        await prepare(Buffer.byteLength(JSON.stringify(event)) + 256, true);
        const result = await current.appendEvent(event);
        if (event.kind === 'checkpoint') {
          baseEvent = result;
        }
        if (
          event.kind === 'checkpoint' ||
          (event.kind === 'mutations' && pinned === 'mutations')
        ) {
          pinned = false;
        }
        return result;
      }),
    writeCheckpoint: (checkpoint) =>
      run(async () => {
        const bytes =
          Buffer.byteLength(checkpoint.html ?? '') +
          Buffer.byteLength(JSON.stringify(checkpoint.state ?? {})) +
          (checkpoint.screenshot?.length ?? 0) +
          1024;
        await prepare(bytes);
        pinned = 'checkpoint';
        base = checkpoint;
        return current.writeCheckpoint(checkpoint);
      }),
    writeMutations: (index, batches) =>
      run(async () => {
        await prepare(Buffer.byteLength(JSON.stringify(batches)) + 256, true);
        const result = await current.writeMutations(index, batches);
        if (pinned !== 'checkpoint') {
          pinned = result ? 'mutations' : false;
        }
        return result;
      }),
    writeMember: (member, contents, writeOptions) =>
      run(async () => {
        await prepare(Buffer.byteLength(contents));
        return current.writeMember(member, contents, writeOptions);
      }),
    writeArtifact: (contents, extension) =>
      run(async () => {
        await prepare(Buffer.byteLength(contents));
        const result = await current.writeArtifact(contents, extension);
        return result
          ? {
              ...result,
              member: segments.length
                ? `${segments.at(-1)}/${result.member}`
                : result.member,
            }
          : null;
      }),
    drop: (record) => run(() => current.drop(record)),
    abort: () => run(() => current.abort()),
    close: (manifest) =>
      run(async () => {
        manifest = await current.close(manifest);
        if (writers.some((writer) => writer.dropped)) {
          manifest.outcome = 'partial';
        }
        // Finished segments get the final capabilities and outcome as well.
        for (const name of segments) {
          const file = path.join(root, name, 'manifest.json');
          const previous = JSON.parse(await fs.readFile(file, 'utf8'));
          await fs.writeFile(
            file,
            JSON.stringify({
              ...manifest,
              counts: previous.counts,
              dropped: previous.dropped,
            }),
            { mode: 0o600 }
          );
        }
        return {
          ...manifest,
          counts: counts(),
          dropped: writers.reduce((sum, b) => sum + b.dropped, 0),
        };
      }),
  };
}
