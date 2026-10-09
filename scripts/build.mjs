import { build } from 'esbuild';
import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const destination = new URL('../dist/', import.meta.url);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await build({ entryPoints: ['src/background.js', 'src/content.js', 'src/popup.js', 'src/options.js'], bundle: true, outdir: 'dist', platform: 'browser', target: 'chrome120', format: 'iife', legalComments: 'eof' });
for (const file of ['manifest.json', 'popup.html', 'options.html', 'ui.css']) await copyFile(`src/${file}`, `dist/${file}`);
await mkdir('dist/licenses', { recursive: true });
for (const [language, packageName] of [['da', 'dictionary-da'], ['en', 'dictionary-en']]) {
  await mkdir(`dist/dictionaries/${language}`, { recursive: true });
  for (const extension of ['aff', 'dic']) await copyFile(`node_modules/${packageName}/index.${extension}`, `dist/dictionaries/${language}/index.${extension}`);
  await copyFile(`node_modules/${packageName}/license`, `dist/licenses/${packageName}.txt`);
}
for (const [name, file] of [['nspell', 'license'], ['is-buffer', 'LICENSE']]) await copyFile(`node_modules/${name}/${file}`, `dist/licenses/${name}.txt`);
await copyFile('THIRD_PARTY.md', 'dist/THIRD_PARTY.md');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}
function icon(size) {
  const scale = 4, width = size * scale;
  const pixels = [];
  for (let y = 0; y < size; y++) {
    pixels.push(0);
    for (let x = 0; x < size; x++) {
      let red = 0, green = 0, blue = 0, alpha = 0;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = (x * scale + dx + .5) / width, py = (y * scale + dy + .5) / width;
        const cornerX = Math.max(.22 - px, px - .78, 0), cornerY = Math.max(.22 - py, py - .78, 0);
        if (Math.hypot(cornerX, cornerY) > .2) continue;
        const distance = Math.hypot(px - .48, py - .52);
        const ring = distance > .225 && distance < .3 && !(px > .54 && py < .42);
        const firstStroke = px > .40 && px < .56 && Math.abs(py - (px + .05)) < .035;
        const secondStroke = px > .53 && px < .84 && Math.abs(py - (1.11 - px)) < .035;
        const ink = ring || firstStroke || secondStroke;
        red += ink ? 255 : 62; green += ink ? 255 : 112; blue += ink ? 255 : 80; alpha += 255;
      }
      const divisor = scale * scale;
      const count = alpha / 255;
      pixels.push(count ? Math.round(red / count) : 0, count ? Math.round(green / count) : 0, count ? Math.round(blue / count) : 0, Math.round(alpha / divisor));
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from(pixels))), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir('dist/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) await writeFile(`dist/icons/${size}.png`, icon(size));
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
console.log(`${manifest.name} ${manifest.version}: Chrome-extension bygget i dist/`);
