import fs from 'node:fs/promises';
import path from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
const compress = promisify(gzip),
  decompress = promisify(gunzip);

export async function readTraceText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    try {
      return (await decompress(await fs.readFile(`${file}.gz`))).toString(
        'utf8'
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}

/** Compress closed NDJSON members only; active traces remain crash-readable. */
export async function gzipTrace(root) {
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    if (item.isDirectory()) {
      await gzipTrace(file);
    } else if (item.name.endsWith('.ndjson')) {
      const temporary = `${file}.gz.tmp`;
      await fs.writeFile(temporary, await compress(await fs.readFile(file)), {
        mode: 0o600,
      });
      await fs.rename(temporary, `${file}.gz`);
      await fs.rm(file);
    }
  }
}
