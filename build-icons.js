'use strict';
const sharp = require('sharp');
const png2icons = require('png2icons');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'assets/Conquered-Time.png');
const ASSETS = path.join(__dirname, 'assets');

const sizes = [16, 32, 48, 256, 512, 1024];

// Circular-crop the square source once at high resolution: mask to an inscribed
// disc (transparent outside) so every derived icon reads as a round icon rather
// than a black square. Masking at 1024 then downscaling keeps the edge smooth.
async function circularSource() {
  const D = 1024;
  const base = await sharp(SRC).resize(D, D).png().toBuffer();
  const mask = Buffer.from(
    `<svg width="${D}" height="${D}" xmlns="http://www.w3.org/2000/svg">
       <circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="#fff"/>
     </svg>`
  );
  return sharp(base)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function main() {
  const round = await circularSource();

  // Generate PNGs at all sizes from the circular master
  for (const size of sizes) {
    const out = path.join(ASSETS, `icon-${size}.png`);
    await sharp(round).resize(size, size).png().toFile(out);
    console.log(`  ✓ icon-${size}.png`);
  }

  // Copy 1024 as icon.png (used by linux builder)
  fs.copyFileSync(path.join(ASSETS, 'icon-1024.png'), path.join(ASSETS, 'icon.png'));
  console.log('  ✓ icon.png');

  // Build .ico from 256px PNG (contains 16/32/48/256 internally)
  const src256 = fs.readFileSync(path.join(ASSETS, 'icon-256.png'));
  const ico = png2icons.createICO(src256, png2icons.BILINEAR, 0, true, true);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), ico);
  console.log('  ✓ icon.ico');

  // Build .icns from 1024px PNG
  const src1024 = fs.readFileSync(path.join(ASSETS, 'icon-1024.png'));
  const icns = png2icons.createICNS(src1024, png2icons.BILINEAR, 0);
  fs.writeFileSync(path.join(ASSETS, 'icon.icns'), icns);
  console.log('  ✓ icon.icns');

  console.log('\nAll icons rebuilt.');
}

main().catch(e => { console.error(e); process.exit(1); });
