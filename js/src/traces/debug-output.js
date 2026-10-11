import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openTraceBundle } from './bundle.js';

/** Managed debug sessions own only a fresh child of the caller's storage root. */
export function validateDebugConfig(config = {}) {
  if (config.retain !== undefined && typeof config.retain !== 'boolean') {
    throw new TypeError('debug retain must be a boolean');
  }
  if (config.retain === false && config.directory === undefined) {
    throw new TypeError('debug retain:false requires a managed directory');
  }
  if (config.directory === undefined) {
    return;
  }
  if (typeof config.directory !== 'string' || config.directory === '') {
    throw new TypeError('debug managed directory must be a path');
  }
  if (config.output !== undefined || config.limits?.rotate) {
    throw new TypeError(
      'debug managed directory cannot use output or rotation'
    );
  }
  if (config.links && config.links !== false) {
    throw new TypeError('debug managed directory uses links:false');
  }
  if (typeof config.network?.har === 'string') {
    throw new TypeError('debug managed HAR must stay inside its directory');
  }
  for (const [name, value] of Object.entries({
    maxBundleBytes: config.limits?.maxBundleBytes ?? 8 * 1024 * 1024,
    maxResourceBytes: config.limits?.maxResourceBytes ?? 1024 * 1024,
    maxDurationMs: config.maxDurationMs ?? 60000,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) {
      throw new RangeError(
        `debug managed ${name} must be a finite positive integer`
      );
    }
  }
}

export async function prepareDebugOutput(options, config) {
  if (config.directory !== undefined) {
    const directory = path.resolve(config.directory);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const output = await fs.mkdtemp(path.join(directory, 'session-'));
    // No unbounded side export or rotation bypasses the managed bundle budget.
    return {
      output,
      owned: true,
      maxDurationMs: config.maxDurationMs ?? 60000,
      traceOptions: {
        ...config,
        // Continuous traces otherwise rotate automatically when the budget fills.
        openBundle: openTraceBundle,
        links: false,
        network: config.network ?? { har: false },
        limits: {
          ...config.limits,
          maxBundleBytes: config.limits?.maxBundleBytes ?? 8 * 1024 * 1024,
          maxResourceBytes: config.limits?.maxResourceBytes ?? 1024 * 1024,
        },
      },
    };
  }
  return {
    output: path.resolve(
      config.output ??
        options.output ??
        process.env.BROWSER_COMMANDER_TRACE ??
        path.join(
          'browser-commander-traces',
          `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}-${randomUUID().slice(0, 8)}`
        )
    ),
    owned: false,
    traceOptions: config,
  };
}
