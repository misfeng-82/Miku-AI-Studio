/* 图片处理服务（sharp）
 *
 * 用途：画布产物与素材的缩略图、封面裁切、水印、体积压缩。
 * 安全：只允许读取 data/ 与 canvas/data/ 下的文件——不接受任意绝对路径，
 *       否则就成了"给个路径就能读整台机器"的文件读取接口。
 */
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, relative, isAbsolute, extname } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(process.cwd());
const ALLOWED_DIRS = [
  join(ROOT, 'data'),
  join(ROOT, 'canvas', 'data'),
  join(ROOT, 'public'),
];

/** 把外部传入的路径解析成允许范围内的绝对路径，越界直接抛错。 */
export function resolveSafePath(input) {
  if (!input || typeof input !== 'string') throw new Error('缺少 path');
  const p = isAbsolute(input) ? resolve(input) : resolve(ROOT, input);
  const ok = ALLOWED_DIRS.some((dir) => {
    const rel = relative(dir, p);
    if (rel === '') return true;                       // 正好是允许目录本身
    return !rel.startsWith('..') && !isAbsolute(rel);  // 落在允许目录内部
  });
  if (!ok) throw new Error(`路径不在允许范围内（只允许 data/、canvas/data/、public/）：${input}`);
  return p;
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.tiff', '.bmp']);

export function isImagePath(p) {
  return IMAGE_EXT.has(extname(p).toLowerCase());
}

/** 探测图片元信息。 */
export async function info(filePath) {
  const p = resolveSafePath(filePath);
  if (!existsSync(p)) throw new Error(`文件不存在：${filePath}`);
  if (!isImagePath(p)) throw new Error(`不是支持的图片格式：${extname(p)}`);
  const meta = await sharp(p).metadata();
  const size = statSync(p).size;
  return {
    path: relative(ROOT, p),
    format: meta.format,
    width: meta.width,
    height: meta.height,
    channels: meta.channels,
    hasAlpha: Boolean(meta.hasAlpha),
    bytes: size,
    kb: Math.round(size / 1024),
    ratio: meta.width && meta.height ? Number((meta.width / meta.height).toFixed(3)) : null,
  };
}

/** 缩略图：等比缩放，不裁剪。 */
export async function thumbnail(filePath, { width = 320, format = 'webp', quality = 82 } = {}) {
  const p = resolveSafePath(filePath);
  if (!existsSync(p)) throw new Error(`文件不存在：${filePath}`);
  const w = clampInt(width, 32, 4096, 320);
  const q = clampInt(quality, 1, 100, 82);
  const pipe = sharp(p).rotate().resize({ width: w, withoutEnlargement: true });
  const out = format === 'png'
    ? await pipe.png({ compressionLevel: 9 }).toBuffer()
    : await pipe.webp({ quality: q }).toBuffer();
  return { buffer: out, contentType: format === 'png' ? 'image/png' : 'image/webp', width: w };
}

/** 封面裁切：按指定宽高比居中裁切（默认 3:4 竖版海报）。 */
export async function coverCrop(filePath, { width = 816, height = 1086, format = 'jpg', quality = 88 } = {}) {
  const p = resolveSafePath(filePath);
  if (!existsSync(p)) throw new Error(`文件不存在：${filePath}`);
  const w = clampInt(width, 64, 6000, 816);
  const h = clampInt(height, 64, 6000, 1086);
  const q = clampInt(quality, 1, 100, 88);
  const pipe = sharp(p).rotate().resize({ width: w, height: h, fit: 'cover', position: 'attention' });
  const out = format === 'png'
    ? await pipe.png({ compressionLevel: 9 }).toBuffer()
    : await pipe.jpeg({ quality: q, mozjpeg: true }).toBuffer();
  return { buffer: out, contentType: format === 'png' ? 'image/png' : 'image/jpeg', width: w, height: h };
}

/** 右下角文字水印（SVG 叠加，无需字体文件，用系统字体族）。 */
export async function watermarkText(filePath, { text = 'Miku AI', opacity = 0.55, format = 'png' } = {}) {
  const p = resolveSafePath(filePath);
  if (!existsSync(p)) throw new Error(`文件不存在：${filePath}`);
  const meta = await sharp(p).metadata();
  const W = meta.width ?? 1000;
  const H = meta.height ?? 1000;
  const fontSize = Math.max(14, Math.round(Math.min(W, H) * 0.045));
  const esc = String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const svg = Buffer.from(
    `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
       <text x="${W - 24}" y="${H - 24}" text-anchor="end"
             font-family="Microsoft YaHei, SimHei, sans-serif"
             font-size="${fontSize}" fill="#FFFFFF" fill-opacity="${clampNum(opacity, 0, 1, 0.55)}"
             stroke="#000000" stroke-opacity="0.25" stroke-width="1">${esc}</text>
     </svg>`,
  );
  const pipe = sharp(p).composite([{ input: svg, gravity: 'southeast' }]);
  const out = format === 'jpg' ? await pipe.jpeg({ quality: 90 }).toBuffer() : await pipe.png().toBuffer();
  return { buffer: out, contentType: format === 'jpg' ? 'image/jpeg' : 'image/png', width: W, height: H };
}

/** 压缩：优先缩体积，保留原格式。 */
export async function compress(filePath, { maxWidth = 1920, quality = 78 } = {}) {
  const p = resolveSafePath(filePath);
  if (!existsSync(p)) throw new Error(`文件不存在：${filePath}`);
  const meta = await sharp(p).metadata();
  const before = statSync(p).size;
  let pipe = sharp(p).rotate();
  if (meta.width && meta.width > maxWidth) pipe = pipe.resize({ width: clampInt(maxWidth, 64, 8000, 1920) });
  const fmt = meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpeg';
  const out = fmt === 'png'
    ? await pipe.png({ compressionLevel: 9, palette: true }).toBuffer()
    : fmt === 'webp'
      ? await pipe.webp({ quality: clampInt(quality, 1, 100, 78) }).toBuffer()
      : await pipe.jpeg({ quality: clampInt(quality, 1, 100, 78), mozjpeg: true }).toBuffer();
  const after = out.length;
  return {
    buffer: out,
    contentType: fmt === 'png' ? 'image/png' : fmt === 'webp' ? 'image/webp' : 'image/jpeg',
    before, after, savedPercent: before ? Math.round((1 - after / before) * 100) : 0,
  };
}

/** 列出可处理的图片（画布产物与上传）。 */
export function listImages({ limit = 60, dir = 'canvas/data' } = {}) {
  const base = resolveSafePath(dir);
  if (!existsSync(base)) return { dir, items: [] };
  const items = [];
  const walk = (cur, depth) => {
    if (depth > 3 || items.length >= limit) return;
    for (const name of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, name.name);
      if (name.isDirectory()) { walk(full, depth + 1); continue; }
      if (items.length >= limit) return;
      if (!isImagePath(name.name)) continue;
      try {
        const st = statSync(full);
        items.push({ path: relative(ROOT, full), bytes: st.size, kb: Math.round(st.size / 1024), mtime: st.mtimeMs });
      } catch { /* 单文件读失败不影响列表 */ }
    }
  };
  walk(base, 0);
  items.sort((a, b) => b.mtime - a.mtime);
  return { dir, count: items.length, items };
}

function clampInt(v, min, max, dflt) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
