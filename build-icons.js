'use strict';

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, 'assets');

const sizes = [
  { svg: 'icon-16.svg',  size: 16  },
  { svg: 'icon-32.svg',  size: 32  },
  { svg: 'icon-48.svg',  size: 48  },
  { svg: 'icon-256.svg', size: 256 },
  { svg: 'icon.svg',     size: 512 },
];

async function exportPNGs() {
  const pngs = [];
  for (const { svg, size } of sizes) {
    const input  = path.join(ASSETS, svg);
    const output = path.join(ASSETS, `icon-${size}.png`);
    await sharp(input).resize(size, size).png().toFile(output);
    console.log(`  ✓ icon-${size}.png`);
    pngs.push({ size, file: output });
  }
  return pngs;
}

async function buildIco(pngs) {
  // ICO format: header + directory + image data
  const images = await Promise.all(
    pngs.filter(p => p.size <= 256).map(async ({ size, file }) => {
      const data = await sharp(file).resize(size, size).png().toBuffer();
      return { size, data };
    })
  );

  const count  = images.length;
  const HEADER = 6;
  const DIRENTRY = 16;
  const dirSize  = count * DIRENTRY;
  let offset = HEADER + dirSize;

  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type: ICO
  header.writeUInt16LE(count, 4);

  const dirs   = [];
  const chunks = [];

  for (const { size, data } of images) {
    const dir = Buffer.alloc(DIRENTRY);
    dir.writeUInt8(size >= 256 ? 0 : size, 0);  // width  (0 = 256)
    dir.writeUInt8(size >= 256 ? 0 : size, 1);  // height (0 = 256)
    dir.writeUInt8(0, 2);   // color count
    dir.writeUInt8(0, 3);   // reserved
    dir.writeUInt16LE(1, 4);  // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(data.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirs.push(dir);
    chunks.push(data);
    offset += data.length;
  }

  const ico = Buffer.concat([header, ...dirs, ...chunks]);
  const out = path.join(ASSETS, 'icon.ico');
  fs.writeFileSync(out, ico);
  console.log(`  ✓ icon.ico (${(ico.length / 1024).toFixed(1)} KB, ${count} sizes)`);
}

(async () => {
  console.log('\nExporting PNGs...');
  const pngs = await exportPNGs();
  console.log('\nBuilding icon.ico...');
  await buildIco(pngs);
  console.log('\nDone.\n');
})().catch(err => { console.error(err); process.exit(1); });
