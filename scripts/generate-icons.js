// Regenerate the action-icon PNGs in src/assets/icons/.
// Run with: node scripts/generate-icons.js
// This exists so the icons in the repo are reproducible from a 50-line
// Node script, not opaque binary blobs. Phase 5 will replace the design
// with the real one; the generator stays so the new design can be
// re-emitted in the same sizes.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

function makePng(size) {
  const bg = [99, 102, 241, 255];
  const fg = [255, 255, 255, 255];
  const w = size, h = size;
  const r = Math.floor(size * 0.18);
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.max(r - x, x - (w - 1 - r), 0);
      const dy = Math.max(r - y, y - (h - 1 - r), 0);
      const insideRounded = (dx * dx + dy * dy) <= r * r;
      let c = insideRounded ? bg : [0, 0, 0, 0];
      const cy = Math.floor(h / 2);
      const barH = Math.max(1, Math.floor(h * 0.08));
      const barX0 = Math.floor(w * 0.28);
      const barX1 = Math.floor(w * 0.72);
      if (insideRounded && y >= cy - barH && y <= cy + barH && x >= barX0 && x <= barX1) {
        c = fg;
      }
      const i = (y * w + x) * 4;
      px[i] = c[0]; px[i+1] = c[1]; px[i+2] = c[2]; px[i+3] = c[3];
    }
  }
  const filtered = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    filtered[y * (w * 4 + 1)] = 0;
    px.copy(filtered, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(filtered);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const outDir = process.argv[2] || path.join(__dirname, "..", "src", "assets", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), makePng(size));
}
console.log("icons regenerated in", outDir);
