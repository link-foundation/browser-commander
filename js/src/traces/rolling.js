import path from 'node:path';

/** Keep the ordinary trace handle while routing every write through rotation. */
export async function startRollingTrace(options, start) {
  const { openRollingBundle } = await import('./rolling-bundle.js');
  const config = options.limits.rotate === true ? {} : options.limits.rotate;
  return start({
    ...options,
    limits: { ...options.limits, rotate: false },
    openBundle: (bundleOptions) =>
      openRollingBundle(bundleOptions, config, options),
  });
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
    screenshot: (index) =>
      locations.get(index)?.opened.screenshot(locations.get(index).index),
    mutations: (index) =>
      locations.get(index)?.opened.mutations(locations.get(index).index) ?? [],
  };
}
