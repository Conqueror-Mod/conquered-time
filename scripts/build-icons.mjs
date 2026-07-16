// Build the full Conquered Time icon asset set from the vector family
// (scripts/icon-family.mjs — the single design source for every size).
//
// Usage: node scripts/build-icons.mjs   (from the repo root)
// Needs installed Chrome (renders the SVGs via playwright-core) + png2icons.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
import { svgFor } from './icon-family.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url))).replace(/\\/g, '/');
const require = createRequire(REPO + '/package.json');
const png2icons = require('png2icons');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ICO_SIZES = [16, 24, 32, 48, 64, 72, 96, 128, 256];
const PNG_OUT = { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 256: 'icon-256.png', 512: 'icon-512.png', 1024: 'icon-1024.png' };
const ALL = [...new Set([...ICO_SIZES, 512, 1024])].sort((a, b) => a - b);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const data = await page.evaluate(async (jobs) => {
  const out = {};
  for (const [pxRaw, svg] of jobs) {
    const px = Number(pxRaw);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej;
      i.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(String(svg)))); });
    const c = document.createElement('canvas'); c.width = c.height = px;
    c.getContext('2d').drawImage(img, 0, 0, px, px);
    const { data: id } = c.getContext('2d').getImageData(0, 0, px, px);
    let bin = ''; const bytes = new Uint8Array(id.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    out[px] = { rgba: btoa(bin), png: c.toDataURL('image/png').split(',')[1] };
  }
  return out;
}, ALL.map(px => [px, svgFor(px)]));
await browser.close();

function bmpEntry(px, rgbaB64) {
  const rgba = Buffer.from(rgbaB64, 'base64');
  const andStride = Math.ceil(px / 32) * 4;
  const buf = Buffer.alloc(40 + px * px * 4 + andStride * px);
  buf.writeUInt32LE(40, 0); buf.writeInt32LE(px, 4); buf.writeInt32LE(px * 2, 8);
  buf.writeUInt16LE(1, 12); buf.writeUInt16LE(32, 14);
  for (let y = 0; y < px; y++) {
    const src = (px - 1 - y) * px * 4, dst = 40 + y * px * 4;
    for (let x = 0; x < px; x++) {
      buf[dst + x * 4] = rgba[src + x * 4 + 2]; buf[dst + x * 4 + 1] = rgba[src + x * 4 + 1];
      buf[dst + x * 4 + 2] = rgba[src + x * 4]; buf[dst + x * 4 + 3] = rgba[src + x * 4 + 3];
    }
  }
  return buf;
}

const entries = [...ICO_SIZES].sort((a, b) => b - a).map(px => ({
  px, data: px === 256 ? Buffer.from(data[px].png, 'base64') : bmpEntry(px, data[px].rgba),
}));
const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = 6 + entries.length * 16;
const dir = entries.map(e => {
  const d = Buffer.alloc(16);
  d[0] = e.px === 256 ? 0 : e.px; d[1] = d[0];
  d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
  d.writeUInt32LE(e.data.length, 8); d.writeUInt32LE(offset, 12);
  offset += e.data.length; return d;
});
fs.writeFileSync(REPO + '/assets/icon.ico', Buffer.concat([header, ...dir, ...entries.map(e => e.data)]));

for (const [px, name] of Object.entries(PNG_OUT))
  fs.writeFileSync(`${REPO}/assets/${name}`, Buffer.from(data[px].png, 'base64'));
// icon.png (generic, used as linux/build fallback) = 512
fs.writeFileSync(REPO + '/assets/icon.png', Buffer.from(data[512].png, 'base64'));

// macOS icns from the 1024 master.
const icns = png2icons.createICNS(Buffer.from(data[1024].png, 'base64'), png2icons.BICUBIC, 0);
if (!icns) throw new Error('icns generation failed');
fs.writeFileSync(REPO + '/assets/icon.icns', icns);

console.log('ico bytes:', fs.statSync(REPO + '/assets/icon.ico').size,
  '| icns bytes:', icns.length, '| pngs:', Object.values(PNG_OUT).join(','), '+ icon.png');
