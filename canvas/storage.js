/* 画布持久层：多画布 / 版本快照 / 资产库 / 生成历史
 *
 * 为什么要有这一层：
 *   原来画布只存在浏览器 localStorage，换设备、清缓存、换浏览器全没了；
 *   生成结果的链接只有 24 小时，过期之后画布上全是裂图。
 * 所以这里做三件事：
 *   1) canvases/      每个画布一个 JSON，带索引，能多开、能改名、能删
 *   2) canvases/_versions/  自动快照，可以回滚到某个时间点
 *   3) assets/        生成结果落盘转存，永久可用，能跨画布复用
 *   4) history.json   生成历史，节点删了还能找回
 *
 * 全部同步读写：画布 JSON 在几十 KB 级别，同步写比异步简单，也不会有竞态。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data');
const CANVAS_DIR = join(DATA_DIR, 'canvases');
const VERSION_DIR = join(CANVAS_DIR, '_versions');
const ASSET_DIR = join(DATA_DIR, 'assets');
const CANVAS_INDEX = join(CANVAS_DIR, '_index.json');
const ASSET_INDEX = join(ASSET_DIR, '_index.json');
const HISTORY_FILE = join(DATA_DIR, 'history.json');

const VERSION_KEEP = 30;        // 每个画布保留多少份快照
const VERSION_GAP_MS = 90 * 1000; // 两次快照最小间隔，避免每敲一个字就存一份
const HISTORY_KEEP = 500;

for (const d of [DATA_DIR, CANVAS_DIR, VERSION_DIR, ASSET_DIR]) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

/* ---------------- 基础 IO ---------------- */

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** 原子写：先写 .tmp 再 rename，断电也不会留下半截 JSON */
function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, file);
}

const nowISO = () => new Date().toISOString();
const rid = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* ---------------- 画布 ---------------- */

function canvasIndex() {
  const idx = readJson(CANVAS_INDEX, null);
  if (Array.isArray(idx?.canvases)) return idx;
  // 首次运行：扫目录重建索引（也用来修复索引丢失）
  const rebuilt = { canvases: [] };
  try {
    for (const f of readdirSync(CANVAS_DIR)) {
      if (!f.endsWith('.json') || f === '_index.json') continue;
      const d = readJson(join(CANVAS_DIR, f), null);
      if (!d) continue;
      rebuilt.canvases.push({
        id: d.id || f.replace(/\.json$/, ''),
        name: d.name || '未命名画布',
        createdAt: d.createdAt || nowISO(),
        updatedAt: d.updatedAt || nowISO(),
        nodeCount: Array.isArray(d.nodes) ? d.nodes.length : 0,
        edgeCount: Array.isArray(d.edges) ? d.edges.length : 0,
      });
    }
  } catch { /* 目录还不存在就留空 */ }
  writeJson(CANVAS_INDEX, rebuilt);
  return rebuilt;
}

function saveCanvasIndex(idx) {
  idx.canvases.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  writeJson(CANVAS_INDEX, idx);
}

export function listCanvases() {
  return canvasIndex().canvases;
}

export function getCanvas(id) {
  const file = join(CANVAS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  return readJson(file, null);
}

export function createCanvas({ name, id, data } = {}) {
  const cid = id || rid('c');
  const doc = {
    id: cid,
    name: name || '未命名画布',
    createdAt: nowISO(),
    updatedAt: nowISO(),
    view: data?.view || { k: 1, x: 0, y: 0 },
    nodes: data?.nodes || [],
    edges: data?.edges || [],
    groups: data?.groups || [],
  };
  writeJson(join(CANVAS_DIR, `${cid}.json`), doc);
  const idx = canvasIndex();
  idx.canvases.push({
    id: cid,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    nodeCount: doc.nodes.length,
    edgeCount: doc.edges.length,
  });
  saveCanvasIndex(idx);
  return doc;
}

/** 保存画布并顺手打一份版本快照（按时间节流） */
export function saveCanvas(id, patch = {}) {
  const file = join(CANVAS_DIR, `${id}.json`);
  const old = existsSync(file) ? readJson(file, null) : null;
  const doc = {
    ...(old || { id, createdAt: nowISO(), view: { k: 1, x: 0, y: 0 }, nodes: [], edges: [], groups: [] }),
    ...patch,
    id,
    updatedAt: nowISO(),
  };
  writeJson(file, doc);

  const idx = canvasIndex();
  const row = idx.canvases.find((c) => c.id === id);
  const meta = {
    id,
    name: doc.name || '未命名画布',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    nodeCount: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
    edgeCount: Array.isArray(doc.edges) ? doc.edges.length : 0,
  };
  if (row) Object.assign(row, meta);
  else idx.canvases.push(meta);
  saveCanvasIndex(idx);

  maybeSnapshot(id, doc);
  return doc;
}

function versionDir(id) {
  const d = join(VERSION_DIR, id);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function maybeSnapshot(id, doc) {
  try {
    const dir = versionDir(id);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    const newest = files.at(-1);
    if (newest) {
      const ts = Number(newest.replace(/\.json$/, ''));
      if (Number.isFinite(ts) && Date.now() - ts < VERSION_GAP_MS) return; // 太密，跳过
    }
    const ts = Date.now();
    writeJson(join(dir, `${ts}.json`), { ts, name: doc.name, nodes: doc.nodes, edges: doc.edges, groups: doc.groups });
    // 超出保留数，删最旧的
    const all = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    while (all.length > VERSION_KEEP) {
      const victim = all.shift();
      try { unlinkSync(join(dir, victim)); } catch { /* ignore */ }
    }
  } catch { /* 快照失败不影响保存 */ }
}

export function listVersions(id) {
  try {
    const dir = join(VERSION_DIR, id);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
    return files.map((f) => {
      const ts = Number(f.replace(/\.json$/, ''));
      const d = readJson(join(dir, f), {});
      return {
        ts,
        at: new Date(ts).toISOString(),
        nodeCount: Array.isArray(d.nodes) ? d.nodes.length : 0,
        edgeCount: Array.isArray(d.edges) ? d.edges.length : 0,
      };
    });
  } catch {
    return [];
  }
}

export function restoreVersion(id, ts) {
  const file = join(versionDir(id), `${ts}.json`);
  if (!existsSync(file)) return null;
  const snap = readJson(file, null);
  if (!snap) return null;
  return saveCanvas(id, { nodes: snap.nodes || [], edges: snap.edges || [], groups: snap.groups || [], name: snap.name });
}

export function deleteCanvas(id) {
  const file = join(CANVAS_DIR, `${id}.json`);
  if (existsSync(file)) {
    try { unlinkSync(file); } catch { /* ignore */ }
  }
  const idx = canvasIndex();
  idx.canvases = idx.canvases.filter((c) => c.id !== id);
  saveCanvasIndex(idx);
  return true;
}

/* ---------------- 资产库 ---------------- */

/** 读资产索引：兼容早期写坏的双层嵌套结构 { assets: { assets: [...] } } */
function readAssetIndex() {
  const raw = readJson(ASSET_INDEX, null);
  let items = [];
  if (Array.isArray(raw)) items = raw;
  else if (Array.isArray(raw?.assets)) items = raw.assets;
  else if (Array.isArray(raw?.assets?.assets)) items = raw.assets.assets;
  return { assets: items };
}

export function listAssets({ kind, q, limit = 200, offset = 0 } = {}) {
  const idx = readAssetIndex();
  let items = idx.assets;
  if (kind && kind !== 'all') items = items.filter((a) => a.kind === kind);
  if (q) {
    const s = String(q).toLowerCase();
    items = items.filter((a) => `${a.name} ${a.prompt} ${a.tags || ''}`.toLowerCase().includes(s));
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { total: items.length, items: items.slice(offset, offset + limit) };
}

function saveAssetIndex(items) {
  writeJson(ASSET_INDEX, { assets: items });
}

function extFromUrl(url, fallback = '.png') {
  try {
    const e = extname(new URL(url, 'http://x').pathname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.m4a'].includes(e)) return e;
  } catch { /* ignore */ }
  return fallback;
}

function kindFromExt(ext) {
  if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a'].includes(ext)) return 'audio';
  return 'image';
}

/**
 * 把生成结果转存进资产库。三种来源：
 *   - 远程 https 链接（AutoDL 的 24 小时临时地址）→ 下载成本地文件
 *   - 本机 /uploads/xxx 或 assets/xxx → 直接复用，不重复下载
 */
export async function addAssetFromUrl(url, meta = {}) {
  if (!url) throw new Error('缺少 url');
  const isLocal = /^(\/)?(uploads|assets)\//.test(url) || url.startsWith('assets/');
  const ext = extFromUrl(url, meta.kind === 'video' ? '.mp4' : '.png');
  const id = rid('a');
  const file = `${id}${ext}`;
  const dest = join(ASSET_DIR, file);

  if (isLocal) {
    const src = join(DATA_DIR, String(url).replace(/^\/+/, '').replace(/^assets\//, 'assets/'));
    if (!existsSync(src)) throw new Error('本地素材不存在');
    writeFileSync(dest, readFileSync(src));
  } else {
    if (!/^https?:\/\//i.test(url)) throw new Error('不支持的地址');
    const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`上游返回 ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    writeFileSync(dest, buf);
  }

  const idx = readAssetIndex();
  const entry = {
    id,
    name: meta.name || `素材 ${new Date().toLocaleString('zh-CN')}`,
    kind: meta.kind || kindFromExt(ext),
    file,
    url: `assets/${file}`,
    mime: ext === '.mp4' ? 'video/mp4' : ext === '.mp3' ? 'audio/mpeg' : `image/${ext.replace('.', '').replace('jpg', 'jpeg')}`,
    size: existsSync(dest) ? statSync(dest).size : 0,
    prompt: meta.prompt || '',
    params: meta.params || {},
    tags: meta.tags || '',
    sourceUrl: isLocal ? '' : url,
    canvasId: meta.canvasId || '',
    nodeId: meta.nodeId || '',
    nodeTitle: meta.nodeTitle || '',
    createdAt: nowISO(),
  };
  idx.assets = [entry, ...idx.assets];
  saveAssetIndex(idx.assets);
  return entry;
}

/** 登记一个已存在上传文件（/api/upload 之后调用，避免二次下载） */
export function addAssetFromUpload(url, meta = {}) {
  return addAssetFromUrl(url, meta);
}

export function deleteAsset(id) {
  const idx = readAssetIndex();
  const hit = idx.assets.find((a) => a.id === id);
  idx.assets = idx.assets.filter((a) => a.id !== id);
  saveAssetIndex(idx.assets);
  if (hit?.file) {
    try { unlinkSync(join(ASSET_DIR, hit.file)); } catch { /* ignore */ }
  }
  return Boolean(hit);
}

export function assetPath(file) {
  const safe = String(file).replace(/[^\w.-]/g, '');
  const p = join(ASSET_DIR, safe);
  return existsSync(p) ? p : null;
}

/* ---------------- 生成历史 ---------------- */

export function listHistory({ canvasId, limit = 100 } = {}) {
  const all = readJson(HISTORY_FILE, []);
  let items = Array.isArray(all) ? all : [];
  if (canvasId) items = items.filter((h) => h.canvasId === canvasId);
  return items.slice(0, limit);
}

export function addHistory(entry = {}) {
  const all = readJson(HISTORY_FILE, []);
  const list = Array.isArray(all) ? all : [];
  const row = {
    id: rid('h'),
    canvasId: entry.canvasId || '',
    nodeId: entry.nodeId || '',
    nodeTitle: entry.nodeTitle || '',
    kind: entry.kind || 'image',
    prompt: entry.prompt || '',
    params: entry.params || {},
    resultUrl: entry.resultUrl || '',
    assetUrl: entry.assetUrl || '',
    status: entry.status || 'done',
    createdAt: nowISO(),
  };
  const next = [row, ...list].slice(0, HISTORY_KEEP);
  writeJson(HISTORY_FILE, next);
  return row;
}

export function clearHistory() {
  writeJson(HISTORY_FILE, []);
  return true;
}
