import fs from 'node:fs/promises';
import path from 'node:path';

/** Bounded complete bundles, each independently readable after a crash. */
export async function startRollingTrace(options, start) {
  const config = options.limits.rotate === true ? {} : options.limits.rotate;
  const maxBytes =
    config.maxBytes ?? options.limits.maxBundleBytes ?? 32 * 1024 * 1024;
  const maxSegments = config.maxSegments ?? 4;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1024 ||
    !Number.isSafeInteger(maxSegments) ||
    maxSegments < 1 ||
    maxSegments > 100
  ) {
    throw new RangeError('invalid trace rotation bounds');
  }
  const root = path.resolve(options.output);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  let current,
    sequence = 0,
    stopping,
    failure,
    ticking = false;
  const segments = [];
  let queue = Promise.resolve();
  const enqueue = (action) => {
    const task = queue.then(action);
    queue = task.catch((error) => {
      failure ??= error;
    });
    return task;
  };
  async function open() {
    const name = `segment-${String(++sequence).padStart(6, '0')}`;
    const output = path.join(root, name);
    current = await start({
      ...options,
      output,
      limits: { ...options.limits, rotate: false, maxBundleBytes: maxBytes },
      links: options.links
        ? { ...options.links, output: path.join(output, 'trace.lino') }
        : null,
    });
    segments.push(name);
    while (segments.length > maxSegments) {
      await fs.rm(path.join(root, segments.shift()), {
        recursive: true,
        force: true,
      });
    }
    const temporary = path.join(root, 'segments.json.tmp');
    await fs.writeFile(temporary, JSON.stringify({ segments }), {
      mode: 0o600,
    });
    await fs.rename(temporary, path.join(root, 'segments.json'));
  }
  await open();
  const timer = setInterval(() => {
    if (!stopping && !ticking) {
      ticking = true;
      enqueue(async () => {
        if (current.bytesWritten >= maxBytes * 0.8) {
          await current.stop();
          await open();
        }
      })
        .catch(() => clearInterval(timer))
        .finally(() => {
          ticking = false;
        });
    }
  }, 100);
  timer.unref?.();
  return {
    path: root,
    mode: options.mode,
    checkpoint: (...args) =>
      enqueue(() => {
        if (stopping) {
          throw new Error('trace has stopped');
        }
        return current.checkpoint(...args);
      }),
    event: (...args) =>
      enqueue(async () => {
        if (stopping) {
          throw new Error('trace has stopped');
        }
        if (
          current.bytesWritten +
            Buffer.byteLength(JSON.stringify(args)) +
            256 >=
          maxBytes * 0.8
        ) {
          await current.stop();
          await open();
        }
        return current.event(...args);
      }),
    stop: (...args) => {
      stopping ??= (async () => {
        clearInterval(timer);
        await queue;
        const result = await current.stop(...args);
        if (args[0]?.discard) {
          await fs.rm(root, { recursive: true, force: true });
        }
        if (failure) {
          throw failure;
        }
        return { ...result, path: root, segments: [...segments] };
      })();
      return stopping;
    },
  };
}

/** Combine segment timelines while keeping checkpoint member paths distinct. */
export async function readRollingTrace(root, index, read) {
  const events = [],
    checkpoints = [],
    locations = new Map();
  let manifest,
    truncated = false,
    number = 0;
  for (const segment of index.segments) {
    if (!/^segment-\d+$/.test(segment)) {
      throw new Error('invalid trace segment path');
    }
    const opened = await read(path.join(root, segment));
    manifest = opened.manifest;
    truncated ||= opened.truncated;
    const ids = new Map();
    for (const checkpoint of opened.checkpoints) {
      const id = ++number;
      ids.set(checkpoint.index, id);
      locations.set(id, { opened, index: checkpoint.index });
      checkpoints.push({
        ...checkpoint,
        index: id,
        members: Object.fromEntries(
          Object.entries(checkpoint.members).map(([key, value]) => [
            key,
            `${segment}/${value}`,
          ])
        ),
      });
    }
    for (const event of opened.events) {
      const mapped = { ...event, segment };
      if (event.kind === 'checkpoint') {
        Object.assign(
          mapped,
          checkpoints.find(
            (checkpoint) => checkpoint.index === ids.get(event.index)
          )
        );
      }
      if (event.kind === 'mutations') {
        mapped.checkpoint = ids.get(event.checkpoint) ?? 0;
      }
      events.push(mapped);
    }
  }
  return {
    path: root,
    manifest,
    events,
    checkpoints,
    truncated,
    html: (index) =>
      locations.get(index)?.opened.html(locations.get(index).index),
    state: (index) =>
      locations.get(index)?.opened.state(locations.get(index).index),
    mutations: (index) =>
      locations.get(index)?.opened.mutations(locations.get(index).index) ?? [],
  };
}
