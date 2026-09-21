/**
 * Opt-in FileHandle leak tracing for Node.js tests.
 *
 * Usage:
 *   node --import ./experiments/trace-open-filehandles.mjs --test ...
 *
 * This preload keeps the default application and test behavior untouched. It
 * records the allocation stack for every `fs/promises.open()` result and
 * reports handles whose `close()` method was never called before process exit.
 */

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

const realOpen = fsPromises.open.bind(fsPromises);
const openHandles = new Map();

fsPromises.open = async (...args) => {
  const handle = await realOpen(...args);
  const allocation = new Error(
    `FileHandle ${handle.fd} opened for ${String(args[0])}`
  );
  openHandles.set(handle, allocation);

  const realClose = handle.close.bind(handle);
  handle.close = async (...closeArgs) => {
    try {
      return await realClose(...closeArgs);
    } finally {
      openHandles.delete(handle);
    }
  };
  return handle;
};

// Keep `import { open } from 'node:fs/promises'` in sync with the patched
// default export, and cover code that reaches the API through `fs.promises`.
fs.promises.open = fsPromises.open;
syncBuiltinESMExports();

process.on('beforeExit', () => {
  for (const allocation of openHandles.values()) {
    console.error(`[open FileHandle]\n${allocation.stack}`);
  }
});
