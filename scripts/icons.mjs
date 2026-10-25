import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}
for (const size of [192,512]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const rounded = (x, y, low, high, radius) => {
    const cx = Math.max(low + radius, Math.min(high - radius, x));
    const cy = Math.max(low + radius, Math.min(high - radius, y));
    return x >= low && x <= high && y >= low && y <= high && Math.hypot(x - cx, y - cy) <= radius;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = x / size, b = y / size;
    let color = [38,117,108,255];
    if (rounded(a,b,.24,.76,.1)) color = [255,252,242,255];
    if ([[.36,.36],[.64,.36],[.5,.5],[.36,.64],[.64,.64]].some(([px,py]) => Math.hypot(a-px,b-py) < .044)) color = [38,117,108,255];
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    color.forEach((v, i) => { pixels[offset + i] = v; });
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size,4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png);
}
