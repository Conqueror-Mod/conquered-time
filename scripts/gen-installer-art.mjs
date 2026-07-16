// Generates the NSIS installer's branded bitmaps from existing brand art.
// NSIS MUI requires BMP (24-bit, uncompressed, bottom-up); sharp can't emit BMP,
// so we render the art to raw RGB and encode the BMP here.
//   node scripts/gen-installer-art.mjs
// Outputs: assets/installer-sidebar.bmp (164x314), assets/installer-header.bmp (150x57)
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ASSETS = path.resolve('assets');

// 24-bit uncompressed BMP (BITMAPINFOHEADER), bottom-up, BGR, rows padded to 4
// bytes. `src` is raw pixel data with `ch` channels per pixel (3 = RGB, 4 = RGBA;
// the alpha channel is ignored). Walking by the real channel count is essential —
// treating 4-channel data as 3 scrambles every row (magenta/green striping).
function encodeBmp24(src, width, height, ch) {
  const rowSize   = Math.floor((24 * width + 31) / 32) * 4;
  const imageSize = rowSize * height;
  const fileSize  = 54 + imageSize;
  const buf = Buffer.alloc(fileSize);
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);            // pixel data offset
  buf.writeUInt32LE(40, 14);            // DIB header size
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);         // positive => bottom-up
  buf.writeUInt16LE(1, 26);             // planes
  buf.writeUInt16LE(24, 28);            // bits per pixel
  buf.writeUInt32LE(imageSize, 34);
  buf.writeInt32LE(2835, 38);           // ~72 DPI (pixels/metre)
  buf.writeInt32LE(2835, 42);
  let off = 54;
  for (let y = height - 1; y >= 0; y--) {
    const rowStart = y * width * ch;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * ch;
      buf[off++] = src[i + 2];          // B
      buf[off++] = src[i + 1];          // G
      buf[off++] = src[i];              // R
    }
    for (let p = width * 3; p < rowSize; p++) buf[off++] = 0; // row padding
  }
  return buf;
}

async function writeBmp(image, w, h, bg, outName) {
  const { data, info } = await image.flatten({ background: bg }).raw().toBuffer({ resolveWithObject: true });
  const bmp = encodeBmp24(data, info.width, info.height, info.channels);
  fs.writeFileSync(path.join(ASSETS, outName), bmp);
  console.log('wrote', outName, `${info.width}x${info.height}`, `${info.channels}ch`, bmp.length, 'bytes');
}

// ── Welcome/finish sidebar (164x314) — full Zanarkand-dark brand panel ──
{
  const W = 164, H = 314;
  const bg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#040810"/>
          <stop offset="1" stop-color="#0c1626"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="30%" r="46%">
          <stop offset="0" stop-color="#e9b949" stop-opacity="0.30"/>
          <stop offset="1" stop-color="#e9b949" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
      <rect width="${W}" height="${H}" fill="url(#glow)"/>
      <text x="${W / 2}" y="210" text-anchor="middle" font-family="Consolas,monospace" font-size="17" letter-spacing="3" font-weight="700" fill="#ffffff">CONQUERED</text>
      <text x="${W / 2}" y="232" text-anchor="middle" font-family="Consolas,monospace" font-size="17" letter-spacing="7" font-weight="700" fill="#ffffff">TIME</text>
      <text x="${W / 2}" y="256" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="9" letter-spacing="0.6" fill="#8aa0b8">Take back your time.</text>
      <rect x="${W / 2 - 22}" y="268" width="44" height="2" rx="1" fill="#e9b949"/>
    </svg>`
  );
  const icon = await sharp(path.join(ASSETS, 'icon-1024.png'))
    .resize(104, 104, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer();
  const img = sharp(bg).composite([{ input: icon, top: 54, left: Math.round((W - 104) / 2) }]);
  await writeBmp(img, W, H, '#040810', 'installer-sidebar.bmp');
}

// ── Inner-page header (150x57) — light, blends with the wizard pages ──
{
  const W = 150, H = 57;
  const bg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="#ffffff"/>
      <text x="50" y="26" font-family="Segoe UI,sans-serif" font-size="13" font-weight="700" fill="#13243c">Conquered</text>
      <text x="50" y="43" font-family="Segoe UI,sans-serif" font-size="13" font-weight="700" fill="#13243c">Time</text>
      <rect x="0" y="${H - 2}" width="${W}" height="2" fill="#e9b949"/>
    </svg>`
  );
  const icon = await sharp(path.join(ASSETS, 'icon-256.png'))
    .resize(38, 38, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png().toBuffer();
  const img = sharp(bg).composite([{ input: icon, top: 9, left: 7 }]);
  await writeBmp(img, W, H, '#ffffff', 'installer-header.bmp');
}
