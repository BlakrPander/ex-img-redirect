// 打包 release 用的 zip：只包含扩展本体，不含 README / 校验脚本
// 用法：node build-release.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'ex-img-rewrite');
const distDir = join(root, 'dist');

const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'));
const version = manifest.version;

// 需要打进包的扩展文件（顺序无关）
const FILES = ['manifest.json', 'rules.json', 'background.js', 'content.js', 'popup.html', 'popup.js'];

if (existsSync(distDir)) rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const outZip = join(distDir, `ex-img-rewrite-v${version}.zip`);

// 手写 ZIP（deflate），避免引入第三方依赖
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const now = new Date();
const { time, date } = dosTime(now);
const localParts = [];
const centralParts = [];
let offset = 0;

for (const name of FILES) {
  const full = join(srcDir, name);
  if (!existsSync(full)) throw new Error(`缺少文件: ${name}`);
  const raw = readFileSync(full);
  const compressed = zlib.deflateRawSync(raw, { level: 9 });
  const crc = crc32(raw);
  const nameBuf = Buffer.from(`ex-img-rewrite/${name}`, 'utf8');

  // local file header
  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);            // version needed
  lfh.writeUInt16LE(0x0800, 6);        // flags: UTF-8
  lfh.writeUInt16LE(8, 8);             // method: deflate
  lfh.writeUInt16LE(time, 10);
  lfh.writeUInt16LE(date, 12);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(compressed.length, 18);
  lfh.writeUInt32LE(raw.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);

  localParts.push(lfh, nameBuf, compressed);

  // central directory header
  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);            // version made by
  cdh.writeUInt16LE(20, 6);            // version needed
  cdh.writeUInt16LE(0x0800, 8);
  cdh.writeUInt16LE(8, 10);
  cdh.writeUInt16LE(time, 12);
  cdh.writeUInt16LE(date, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(compressed.length, 20);
  cdh.writeUInt32LE(raw.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt16LE(0, 30);            // extra len
  cdh.writeUInt16LE(0, 32);            // comment len
  cdh.writeUInt16LE(0, 34);            // disk
  cdh.writeUInt16LE(0, 36);            // internal attrs
  cdh.writeUInt32LE(0o644 << 16, 38);  // external attrs
  cdh.writeUInt32LE(offset, 42);

  centralParts.push(cdh, nameBuf);
  offset += lfh.length + nameBuf.length + compressed.length;
}

const centralBuf = Buffer.concat(centralParts);
const localBuf = Buffer.concat(localParts);

const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(FILES.length, 8);
eocd.writeUInt16LE(FILES.length, 10);
eocd.writeUInt32LE(centralBuf.length, 12);
eocd.writeUInt32LE(localBuf.length, 16);
eocd.writeUInt16LE(0, 20);

const zip = Buffer.concat([localBuf, centralBuf, eocd]);
writeFileSync(outZip, zip);

// 同时输出一份解压后的目录，方便"加载已解压"
const unpacked = join(distDir, 'ex-img-rewrite');
mkdirSync(unpacked, { recursive: true });
for (const name of FILES) {
  writeFileSync(join(unpacked, name), readFileSync(join(srcDir, name)));
}

console.log(`版本: ${version}`);
console.log(`已生成: ${outZip} (${zip.length} 字节)`);
console.log(`已生成解压目录: ${unpacked}`);
console.log(`包含 ${FILES.length} 个文件: ${FILES.join(', ')}`);
