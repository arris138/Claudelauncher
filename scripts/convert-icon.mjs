import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src-tauri', 'icons');
const svgData = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');

// Sizes needed by Tauri
const sizes = [32, 64, 128, 256, 512];
// Windows Store logos
const storeSizes = [
  { name: 'StoreLogo', size: 50 },
  { name: 'Square30x30Logo', size: 30 },
  { name: 'Square44x44Logo', size: 44 },
  { name: 'Square71x71Logo', size: 71 },
  { name: 'Square89x89Logo', size: 89 },
  { name: 'Square107x107Logo', size: 107 },
  { name: 'Square142x142Logo', size: 142 },
  { name: 'Square150x150Logo', size: 150 },
  { name: 'Square284x284Logo', size: 284 },
  { name: 'Square310x310Logo', size: 310 },
];

function renderPng(svg, width, height) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
  });
  const rendered = resvg.render();
  return rendered.asPng();
}

// Generate standard sizes
for (const size of sizes) {
  const png = renderPng(svgData, size, size);
  const filename = size === 512 ? 'icon.png' : `${size}x${size}.png`;
  writeFileSync(join(iconsDir, filename), png);
  console.log(`Generated ${filename}`);
}

// 128x128@2x is 256x256
const png2x = renderPng(svgData, 256, 256);
writeFileSync(join(iconsDir, '128x128@2x.png'), png2x);
console.log('Generated 128x128@2x.png');

// Store logos
for (const { name, size } of storeSizes) {
  const png = renderPng(svgData, size, size);
  writeFileSync(join(iconsDir, `${name}.png`), png);
  console.log(`Generated ${name}.png`);
}

// Generate ICO file (contains 16, 32, 48, 256 px)
// ICO format: header + directory entries + image data
function createIco(svg, icoSizes) {
  const images = icoSizes.map(size => renderPng(svg, size, size));

  // ICO header: 6 bytes
  const headerSize = 6;
  const dirEntrySize = 16;
  const numImages = images.length;

  // Calculate offsets
  let offset = headerSize + dirEntrySize * numImages;
  const offsets = [];
  for (const img of images) {
    offsets.push(offset);
    offset += img.length;
  }

  // Total size
  const totalSize = offset;
  const buffer = Buffer.alloc(totalSize);

  // Header
  buffer.writeUInt16LE(0, 0);      // Reserved
  buffer.writeUInt16LE(1, 2);      // Type: ICO
  buffer.writeUInt16LE(numImages, 4); // Number of images

  // Directory entries
  for (let i = 0; i < numImages; i++) {
    const size = icoSizes[i];
    const entryOffset = headerSize + i * dirEntrySize;
    buffer.writeUInt8(size >= 256 ? 0 : size, entryOffset);     // Width (0 = 256)
    buffer.writeUInt8(size >= 256 ? 0 : size, entryOffset + 1); // Height
    buffer.writeUInt8(0, entryOffset + 2);                       // Color palette
    buffer.writeUInt8(0, entryOffset + 3);                       // Reserved
    buffer.writeUInt16LE(1, entryOffset + 4);                    // Color planes
    buffer.writeUInt16LE(32, entryOffset + 6);                   // Bits per pixel
    buffer.writeUInt32LE(images[i].length, entryOffset + 8);     // Image size
    buffer.writeUInt32LE(offsets[i], entryOffset + 12);          // Offset
  }

  // Image data
  for (let i = 0; i < numImages; i++) {
    images[i].copy(buffer, offsets[i]);
  }

  return buffer;
}

const ico = createIco(svgData, [16, 32, 48, 256]);
writeFileSync(join(iconsDir, 'icon.ico'), ico);
console.log('Generated icon.ico');

console.log('\nAll icons generated successfully!');
