import fs from 'node:fs/promises';

/** Return capture bytes and optionally persist them with private permissions. */
export async function writeCapture(bytes, output) {
  if (output) {
    await fs.writeFile(output, bytes, { mode: 0o600 });
  }
  return bytes;
}
