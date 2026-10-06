// Renders the pixel-art app icons into public/icons as PNG files (no dependencies).
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { ICONS, PALETTE } from '../src/pixel.js';

const BACKGROUND = '#0b0b1a';
const SIZES = [192, 512];
// Keep the sprite inside the maskable-icon safe zone.
const SPRITE_FRACTION = 0.6;

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixelAt(x, y);
      raw.set([r, g, b], rowStart + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function renderIcon(size, sprite) {
  const cols = sprite[0].length;
  const rows = sprite.length;
  const scale = Math.floor((size * SPRITE_FRACTION) / cols);
  const offsetX = Math.floor((size - cols * scale) / 2);
  const offsetY = Math.floor((size - rows * scale) / 2);
  const background = hexToRgb(BACKGROUND);
  const colors = Object.fromEntries(Object.entries(PALETTE).map(([ch, hex]) => [ch, hexToRgb(hex)]));

  return encodePng(size, (x, y) => {
    const col = Math.floor((x - offsetX) / scale);
    const row = Math.floor((y - offsetY) / scale);
    if (x < offsetX || y < offsetY || col >= cols || row >= rows) return background;
    return colors[sprite[row][col]] ?? background;
  });
}

const outDir = new URL('../public/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  writeFileSync(new URL(`icon-${size}.png`, outDir), renderIcon(size, ICONS.invader));
  console.log(`icon-${size}.png`);
}
