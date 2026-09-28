// Convert an Xvfb framebuffer dump (Xvfb -fbdir <dir> writes XWD) into a PNG,
// so screenshots include Chrome's own UI (infobars, bubbles), which CDP
// page screenshots cannot show. Supports the 24/32-bit ZPixmap Xvfb produces.
// Usage: node xwd-to-png.mjs <Xvfb_screen0> <out.png> [cropHeight]
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const [input, output, cropHeightArg] = process.argv.slice(2);
const data = readFileSync(input);
const u32 = (offset) => data.readUInt32BE(offset);
const headerSize = u32(0);
const width = u32(16);
const height = u32(20);
const byteOrder = u32(28); // 0 = LSBFirst
const bitsPerPixel = u32(44);
const bytesPerLine = u32(48);
const colormapEntries = u32(76);
const pixelsStart = headerSize + colormapEntries * 12;
if (bitsPerPixel !== 32) throw new Error(`unsupported bpp ${bitsPerPixel}`);
const outHeight = Math.min(height, Number(cropHeightArg ?? height));
const raw = Buffer.alloc((width * 3 + 1) * outHeight);
for (let y = 0; y < outHeight; y++) {
  raw[y * (width * 3 + 1)] = 0;
  for (let x = 0; x < width; x++) {
    const offset = pixelsStart + y * bytesPerLine + x * 4;
    const pixel =
      byteOrder === 0 ? data.readUInt32LE(offset) : data.readUInt32BE(offset);
    const target = y * (width * 3 + 1) + 1 + x * 3;
    raw[target] = (pixel >> 16) & 0xff;
    raw[target + 1] = (pixel >> 8) & 0xff;
    raw[target + 2] = pixel & 0xff;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, body) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(outHeight, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(
  output,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
);
console.log(`wrote ${output} ${width}x${outHeight}`);
